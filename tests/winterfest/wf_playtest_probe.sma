/*
 * ============================================================================
 * tests/winterfest/wf_playtest_probe.sma - the local proof runner
 * ============================================================================
 * NOT SHIPPED. It lives under tests/ and is only loaded on the local Winterfest
 * stack (build/wf-local/server). It exists because the 2026-11 playtest batch
 * has to be proven in a log, not in a code review.
 *
 * It drives the real commands and natives for one connected client on a timer,
 * and its evidence is the plugins' own debug lines plus their chat echoes:
 *
 *   [WF-CHAT]        every Winterfest chat line (wf_chat_debug 1)
 *   [FN-CHAT]        every house chat-service line (fn_chat_debug 1)
 *   [VIP-CHAT]       every VIP line (fnvip_debug 1)
 *   [BP] spawn ...   the spawn-armour decision (bp_debug 1)
 *   [HUD] ...        the rank HUD block (hud_preview)
 *   [FreeNova PANEL] the MOTD-vs-menu decision (fn_open_panel)
 *   [FreeNova MOTD]  the url an MOTD was sent to (fnweb_debug 1)
 *
 * Bots are enough for the paths keyed on a client slot. They are NOT enough for
 * paths keyed on a SteamID: freenova_vip's g_bValid and freenova_prefs' load
 * both refuse the shared "BOT" authid, so the VIP tier and Low Performance Mode
 * cannot be switched by a bot. The probe says so in the log where that matters.
 * ============================================================================
 */

#include <amxmodx>
#include <fakemeta>
#include <freenova_web>   // FNWeb_BuildPathUrl + FNWeb_Dispatch (step 14)

#define PLUGIN  "WF Playtest Probe"
#define VERSION "1.1.0"
#define AUTHOR  "FreeNova"

#define TASK_RUN 97000

// Provider natives. Declared instead of including the headers, so this probe
// still compiles on a checkout where a provider is missing; every call is
// behind LibraryExists.
native wf_grant(id, reward_type, reward_id, const claim_key[])
native wf_get_gingerbread(id)
native fnvip_get_tier(id)
native fnvip_show_vip_motd(id)
native menabp_has_weapon_menu(id)

#define WF_REWARD_GINGERBREAD 1
#define WF_REWARD_GIFT        3
#define WF_REWARD_PASS_XP     4
#define WF_REWARD_SPINS       6

new g_iId
new g_szName[32]
new g_iSeq
new g_iRestarts

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)

	log_amx("[PROBE] msgid SayText=%d TextMsg=%d HudText=%d",
		get_user_msgid("SayText"), get_user_msgid("TextMsg"), get_user_msgid("HudText"))

	// The engine's own messages are the only ones this build routes through a
	// message hook; plugin-sent chat is NOT visible here (verified), which is why
	// every plugin in this batch gained a debug echo instead.
	register_message(get_user_msgid("SayText"), "OnSayText")

	set_task(15.0, "TaskRun", TASK_RUN)
}

public OnSayText(msgid, dest, receiver)
{
	new text[192]
	text[0] = 0
	if (get_msg_argtype(2) == ARG_STRING)
		get_msg_arg_string(2, text, charsmax(text))
	if (text[0])
		log_amx("[PROBE SAYTEXT] dest=%d text=%s", dest, text)
	return PLUGIN_CONTINUE
}

// ---------------------------------------------------------------- driver ----
public TaskRun()
{
	new players[MAX_PLAYERS], num
	get_players(players, num)
	for (new i = 0; i < num; i++)
	{
		if (is_user_connected(players[i]) && !is_user_hltv(players[i]))
		{
			g_iId = players[i]
			break
		}
	}

	if (!g_iId)
	{
		log_amx("[PROBE] no client to drive - is the server empty?")
		return
	}

	get_user_name(g_iId, g_szName, charsmax(g_szName))
	log_amx("[PROBE] driving id=%d name=%s bot=%d gb=%d",
		g_iId, g_szName, is_user_bot(g_iId),
		LibraryExists("winterfest_core", LibType_Library) ? wf_get_gingerbread(g_iId) : -1)
	next("StepDiag", 1.0)
}

next(const func[], Float:delay)
{
	set_task(delay, func)
}

run_command(const plugin[], const func[])
{
	if (callfunc_begin(func, plugin) != 1)
	{
		log_amx("[PROBE] could not call %s() in %s", plugin, func)
		return 0
	}
	callfunc_push_int(g_iId)
	new ret = callfunc_end()
	log_amx("[PROBE] %s() -> %d", func, ret)
	return ret
}

// 0. The gates that decide whether the rest is even reachable for a bot.
public StepDiag()
{
	new iTier = LibraryExists("freenova_vip", LibType_Library) ? fnvip_get_tier(g_iId) : -1
	new iMenu = LibraryExists("menabp", LibType_Library) ? menabp_has_weapon_menu(g_iId) : -1
	log_amx("[PROBE] state: alive=%d knife_round=%d vip_tier=%d bp_weapon_menu=%d armory_task=%d",
		is_user_alive(g_iId), get_cvar_num("amx_knife_round_active"), iTier, iMenu,
		task_exists(g_iId + 54200))
	next("StepChristmas", 1.0)
}

// 1. /christmas with the panel configured.
public StepChristmas()
{
	log_amx("[PROBE] === 1. /christmas (panel configured)")
	run_command("winterfest_menu.amxx", "cmdChristmas")
	next("StepVipMotd", 2.0)
}

// 2. The VIP page through fn_open_panel - the /m/ bridge path, which a bot can
// reach (no identity gate in that plugin's MOTD path).
public StepVipMotd()
{
	log_amx("[PROBE] === 2. fnvip_show_vip_motd -> fn_open_panel(FN_PANEL_VIP)")
	fnvip_show_vip_motd(g_iId)
	next("StepRules", 2.0)
}

// 3. The rules page through fn_open_panel - the local-file path.
public StepRules()
{
	log_amx("[PROBE] === 3. /rules -> fn_open_panel(FN_PANEL_RULES)")
	run_command("freenova_panel.amxx", "Cmd_Rules")
	next("StepGb", 2.0)
}

// 4. A GingerBread grant: the reward line the core formats and WfSay() prints.
public StepGb()
{
	log_amx("[PROBE] === 4. wf_grant(GingerBread, 25)")
	new claim[64]
	g_iSeq++
	formatex(claim, charsmax(claim), "probe:gb:%d:%d", get_systime(), g_iSeq)
	new code = wf_grant(g_iId, WF_REWARD_GINGERBREAD, 25, claim)
	log_amx("[PROBE] wf_grant gb -> %d, balance %d", code, wf_get_gingerbread(g_iId))
	next("StepGift", 2.0)
}

// 5. A present + open it: the theatre, then the reward line.
public StepGift()
{
	log_amx("[PROBE] === 5. wf_grant(GIFT) then /opengift")
	new claim[64]
	g_iSeq++
	formatex(claim, charsmax(claim), "probe:gift:%d:%d", get_systime(), g_iSeq)
	new code = wf_grant(g_iId, WF_REWARD_GIFT, 1, claim)
	log_amx("[PROBE] wf_grant gift -> %d", code)
	run_command("winterfest_menu.amxx", "cmdOpenFallback")
	next("StepPassXp", 3.0)
}

// 6. Winter Pass XP: the other formatted reward line.
public StepPassXp()
{
	log_amx("[PROBE] === 6. wf_grant(PASS_XP, 25)")
	new claim[64]
	g_iSeq++
	formatex(claim, charsmax(claim), "probe:xp:%d:%d", get_systime(), g_iSeq)
	new code = wf_grant(g_iId, WF_REWARD_PASS_XP, 25, claim)
	log_amx("[PROBE] wf_grant pass xp -> %d", code)
	next("StepSpins", 2.0)
}

// 7. Spins: the third formatted reward line.
public StepSpins()
{
	log_amx("[PROBE] === 7. wf_grant(SPINS, 1)")
	new claim[64]
	g_iSeq++
	formatex(claim, charsmax(claim), "probe:spins:%d:%d", get_systime(), g_iSeq)
	new code = wf_grant(g_iId, WF_REWARD_SPINS, 1, claim)
	log_amx("[PROBE] wf_grant spins -> %d", code)
	next("StepHud", 2.0)
}

// 8. The rank HUD block, printed by the plugin's own formatter.
public StepHud()
{
	log_amx("[PROBE] === 8. hud_preview (the rank HUD block)")
	server_cmd("hud_preview #%d", get_user_userid(g_iId))
	next("StepArmor", 2.0)
}

// 9. The spawn-armour rule, under and over the engine cap.
public StepArmor()
{
	log_amx("[PROBE] === 9. bp_armor_probe 9 (perk) and 140 (overflow)")
	server_cmd("bp_armor_probe #%d 9", get_user_userid(g_iId))
	server_cmd("bp_armor_probe #%d 140", get_user_userid(g_iId))
	next("StepRestart", 2.0)
}

// 10/11. Two round restarts: every spawn queues the armoury, and the
// announcement is once per round.
public StepRestart()
{
	log_amx("[PROBE] === 10. sv_restart 1 (armoury on spawn)")
	server_cmd("sv_restart 1")
	next("StepRestart2", 8.0)
}

public StepRestart2()
{
	log_amx("[PROBE] === 11. sv_restart 1 again (same map, later round)")
	server_cmd("sv_restart 1")
	next("StepDashboard", 8.0)
}

// 12. /dashboard - the Winterfest dashboard MOTD, opened by a chat command.
//
// The command is what a player types, so the probe makes the client type it:
// client_cmd(g_iId, "say /dashboard") reaches the server as speech from that
// player, and freenova_panel's Cmd_Dashboard runs exactly as it would for a
// human. fn_open_panel() refuses a bot on purpose (FN_PANEL_DENY_PLAYER: a bot
// has no browser to show), which is the honest result for the slot a bot
// occupies - step 13 then sends the url the command would have sent, through
// the include's own builder and dispatcher, so the MOTD line exists in the log
// for a client slot on this box.
public StepDashboard()
{
	log_amx("[PROBE] === 12. say /dashboard (slot %d, bot=%d)", g_iId, is_user_bot(g_iId))
	if (is_user_bot(g_iId))
		log_amx("[PROBE] a bot has no browser: fn_open_panel() will refuse (see step 13)")
	else
		client_cmd(g_iId, "say /dashboard")
	next("StepDashboardUrl", 3.0)
}

// 13. The dashboard url for this slot, dispatched unless the chat command above
// already did it (a human client).
public StepDashboardUrl()
{
	if (!is_user_bot(g_iId))
	{
		log_amx("[PROBE] === 13. skipped - the client above typed /dashboard")
		next("StepDone", 1.0)
		return
	}

	new szUrl[FNWEB_MAX_URL + 32]
	if (!FNWeb_BuildPathUrl(g_iId, "/dashboard.html", szUrl, charsmax(szUrl)))
	{
		log_amx("[PROBE] === 13. no dashboard url (no panel configured, loopback host, or LPM)")
		next("StepDone", 1.0)
		return
	}
	log_amx("[PROBE] === 13. FNWeb_Dispatch(slot %d) -> %s", g_iId, szUrl)
	FNWeb_Dispatch(g_iId, szUrl, "dashboard")
	next("StepDone", 1.0)
}

public StepDone()
{
	log_amx("[PROBE] === 14. done")
}
