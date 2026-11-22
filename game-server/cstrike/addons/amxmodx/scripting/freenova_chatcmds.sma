/*
 * ============================================================================
 * FreeNova Chat Commands  (freenova_chatcmds)
 * ============================================================================
 * Chat shortcuts for team transfer and direct moderation routing.
 *
 * TRANSFER (self only, no permission needed):
 *   /t    -> move self to Terrorists
 *   /ct   -> move self to Counter-Terrorists
 *   /spec -> move self to Spectator
 *   Dead-only by default. Cvar fncc_live_transfer (default 0): when 0 a live
 *   player is refused with a "you must be dead" message; when 1 a live player
 *   is killed first and changes team (kill+respawn semantics: stock CS 1.6 has
 *   no instant-respawn native, so the player respawns on the NEW team at the
 *   next round; /spec takes effect immediately after the kill).
 *   Implementation uses cs_set_user_team() (cstrike, always present).
 *
 * MODERATION (direct-action forms only; bare forms fall through to the panel):
 *   /ban <target> <minutes> [reason]  - ADMIN_BAN (d), routed to amx_ban
 *   /kick <target> [reason]            - ADMIN_KICK (c), routed to amx_kick
 *   /gag <target> <minutes> <a|b|c> [reason] - ADMIN_KICK (c) chat gate,
 *       routed to amx_gag (which enforces the full cdeijuv set itself).
 *
 * SINGLE-OWNER RULE: this plugin NEVER implements bans/kicks/gags. It only
 * routes via server_cmd() to the owning concmds: amx_ban/amx_banip (Preset-A
 * ban backend via advanced_bans), amx_kick (stock admincmd), amx_gag/amx_ungag
 * (freenova_gag). No permission logic is duplicated either: the owned concmds
 * re-enforce their own gates; the chat-level gate here only avoids leaking
 * usage to players without a chance of succeeding.
 *
 * PANEL COEXISTENCE (freenova_panel owns say /ban /kick /gag menus):
 *   freenova_panel Cmd_Ban/Cmd_Kick/Cmd_Gag return PLUGIN_HANDLED
 *   unconditionally (menu or "Admin only"). AMXX dispatches matching clcmd
 *   handlers in REGISTRATION order and stops at the first PLUGIN_HANDLED.
 *   Therefore:
 *     - Bare "/ban" (no args) -> this plugin returns PLUGIN_CONTINUE so the
 *       panel menu still opens. No behavior change for menu users.
 *     - "/ban <args>" -> this plugin routes the direct command and returns
 *       PLUGIN_HANDLED. This REQUIRES this plugin to load BEFORE freenova_panel
 *       (registration order = plugins.ini order). If the panel loads first,
 *       the direct forms are inert (panel menu opens instead); transfers and
 *       bare-menu passthrough keep working either way.
 *   plugins.ini is NOT edited by this plugin; the order requirement is stated
 *   here and in the load-order note below.
 *
 * LOAD ORDER: freenova_chatcmds BEFORE freenova_panel (direct /ban /kick /gag
 * with args preempt the panel menu; bare forms still reach the panel).
 *
 * No optional providers are used (cstrike/amxmisc are core), so no
 * LibraryExists gate is needed.
 *
 * Cvars (fncc_*):
 *   fncc_live_transfer   0 - 0 = transfers dead-only; 1 = allow live transfer
 *                             (kill first, respawn on new team next round)
 * ============================================================================
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>

#define PLUGIN  "FreeNova Chat Commands"
#define VERSION "1.0.0"
#define AUTHOR  "FreeNova"

new g_pCvarLiveTransfer

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    register_clcmd("say /t", "Cmd_T")
    register_clcmd("say_team /t", "Cmd_T")
    register_clcmd("say /ct", "Cmd_Ct")
    register_clcmd("say_team /ct", "Cmd_Ct")
    register_clcmd("say /spec", "Cmd_Spec")
    register_clcmd("say_team /spec", "Cmd_Spec")

    register_clcmd("say /ban", "Cmd_Ban")
    register_clcmd("say_team /ban", "Cmd_Ban")
    register_clcmd("say /kick", "Cmd_Kick")
    register_clcmd("say_team /kick", "Cmd_Kick")
    register_clcmd("say /gag", "Cmd_Gag")
    register_clcmd("say_team /gag", "Cmd_Gag")

    g_pCvarLiveTransfer = register_cvar("fncc_live_transfer", "0")
}

// ============================================================================
// TRANSFER
// ============================================================================

public Cmd_T(id)
{
    TransferSelf(id, CS_TEAM_T, "Terrorists")
    return PLUGIN_HANDLED
}

public Cmd_Ct(id)
{
    TransferSelf(id, CS_TEAM_CT, "Counter-Terrorists")
    return PLUGIN_HANDLED
}

public Cmd_Spec(id)
{
    TransferSelf(id, CS_TEAM_SPECTATOR, "Spectator")
    return PLUGIN_HANDLED
}

TransferSelf(id, CsTeams:iTeam, const szLabel[])
{
    if (!is_user_connected(id))
        return

    if (cs_get_user_team(id) == iTeam)
    {
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 You are already %s.", szLabel)
        return
    }

    // Dead-only unless the live-transfer cvar allows killing first.
    // Kill+respawn semantics: user_kill() ends the current life; the engine
    // respawns the player on the NEW team at the next round (stock CS 1.6 has
    // no instant respawn). Spectator takes effect immediately after the kill.
    if (is_user_alive(id) && !get_pcvar_num(g_pCvarLiveTransfer))
    {
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 You must be dead to switch teams (or wait for the next round).")
        return
    }

    cs_set_user_team(id, iTeam)
    if (is_user_alive(id))
        user_kill(id)

    client_print_color(id, print_team_default,
        "^4[FreeNova]^1 You are now %s.", szLabel)

    new szName[32]
    get_user_name(id, szName, charsmax(szName))
    log_amx("[FreeNova][ChatCmds] %s transferred self to %s", szName, szLabel)
}

// ============================================================================
// MODERATION ROUTING (direct forms; bare forms fall through to panel menus)
// ============================================================================

// Splits the say remainder into space-separated tokens. Returns token count.
Tokenize(const szText[], szArg1[], iLen1, szArg2[], iLen2, szArg3[], iLen3)
{
    new szCopy[192]
    copy(szCopy, charsmax(szCopy), szText)

    new iNum = parse(szCopy,
        szArg1, iLen1,
        szArg2, iLen2,
        szArg3, iLen3)

    return iNum
}

// Reads the text after "say /cmd". Returns false when there are no args
// (caller must return PLUGIN_CONTINUE so the panel menu still opens).
bool:ReadRemainder(szOut[], iLen)
{
    read_args(szOut, iLen)
    remove_quotes(szOut)
    trim(szOut)

    // Strip the "/cmd" head token, keep the remainder.
    new szHead[16], szRest[192]
    parse(szOut, szHead, charsmax(szHead), szRest, charsmax(szRest))
    trim(szRest)
    copy(szOut, iLen, szRest)

    return szOut[0] ? true : false
}

public Cmd_Ban(id)
{
    new szRest[192]
    if (!ReadRemainder(szRest, charsmax(szRest)))
        return PLUGIN_CONTINUE   // bare /ban -> panel player-select menu

    if (!(get_user_flags(id) & ADMIN_BAN))
    {
        client_print_color(id, print_team_red,
            "^4[FreeNova]^1 You do not have permission to ban (requires ban flag).")
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 Usage: /ban <target> <minutes> [reason]")
        return PLUGIN_HANDLED
    }

    new szTarget[64], szMinutes[16], szExtra[128]
    if (Tokenize(szRest, szTarget, charsmax(szTarget), szMinutes, charsmax(szMinutes), szExtra, charsmax(szExtra)) < 2)
    {
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 Usage: /ban <target> <minutes> [reason]")
        return PLUGIN_HANDLED
    }

    new szName[32]
    get_user_name(id, szName, charsmax(szName))
    log_amx("[FreeNova][ChatCmds] %s routed /ban: %s", szName, szRest)

    // Single-owner rule: the ban backend (advanced_bans amx_ban) validates,
    // applies and logs. We only pass the argument string through.
    server_cmd("amx_ban %s", szRest)
    client_print_color(id, print_team_default,
        "^4[FreeNova]^1 Ban command sent for ^3%s^1.", szTarget)
    return PLUGIN_HANDLED
}

public Cmd_Kick(id)
{
    new szRest[192]
    if (!ReadRemainder(szRest, charsmax(szRest)))
        return PLUGIN_CONTINUE   // bare /kick -> panel player-select menu

    if (!(get_user_flags(id) & ADMIN_KICK))
    {
        client_print_color(id, print_team_red,
            "^4[FreeNova]^1 You do not have permission to kick (requires kick flag).")
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 Usage: /kick <target> [reason]")
        return PLUGIN_HANDLED
    }

    new szTarget[64], szRest2[128], szRest3[64]
    if (Tokenize(szRest, szTarget, charsmax(szTarget), szRest2, charsmax(szRest2), szRest3, charsmax(szRest3)) < 1)
    {
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 Usage: /kick <target> [reason]")
        return PLUGIN_HANDLED
    }

    new szName[32]
    get_user_name(id, szName, charsmax(szName))
    log_amx("[FreeNova][ChatCmds] %s routed /kick: %s", szName, szRest)

    // Single-owner rule: stock amx_kick validates, applies and logs.
    server_cmd("amx_kick %s", szRest)
    client_print_color(id, print_team_default,
        "^4[FreeNova]^1 Kick command sent for ^3%s^1.", szTarget)
    return PLUGIN_HANDLED
}

public Cmd_Gag(id)
{
    new szRest[192]
    if (!ReadRemainder(szRest, charsmax(szRest)))
        return PLUGIN_CONTINUE   // bare /gag -> panel gag menu

    // Chat-level gate is ADMIN_KICK (c), matching the help-table "chat+kick"
    // family. The routed amx_gag concmd (freenova_gag, FLAG_ADMIN = cdeijuv)
    // re-enforces the full admin set, so a kick-flagged non-admin can never
    // actually gag through this path.
    if (!(get_user_flags(id) & ADMIN_KICK))
    {
        client_print_color(id, print_team_red,
            "^4[FreeNova]^1 You do not have permission to gag (requires kick flag).")
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 Usage: /gag <target> <minutes> <a|b|c> [reason]")
        return PLUGIN_HANDLED
    }

    new szTarget[64], szMinutes[16], szType[128]
    if (Tokenize(szRest, szTarget, charsmax(szTarget), szMinutes, charsmax(szMinutes), szType, charsmax(szType)) < 3)
    {
        client_print_color(id, print_team_default,
            "^4[FreeNova]^1 Usage: /gag <target> <minutes> <a|b|c> [reason]")
        return PLUGIN_HANDLED
    }

    new szName[32]
    get_user_name(id, szName, charsmax(szName))
    log_amx("[FreeNova][ChatCmds] %s routed /gag: %s", szName, szRest)

    // Single-owner rule: freenova_gag amx_gag validates, applies and logs.
    server_cmd("amx_gag %s", szRest)
    client_print_color(id, print_team_default,
        "^4[FreeNova]^1 Gag command sent for ^3%s^1.", szTarget)
    return PLUGIN_HANDLED
}
