#if defined _freenova_web_included
    #endinput
#endif
#define _freenova_web_included

#include <freenova_prefs>

// FreeNova web-panel MOTD bridge.
//
// GoldSrc's in-game browser returns HTTP error -102 when:
//   1. the URL is longer than ~96-120 characters
//   2. the URL has no file extension (IE/GoldSrc treats it as invalid)
//   3. the URL contains query-string SteamIDs with ':' (STEAM_0:1:123)
//   4. the host is 127.0.0.1 (the CLIENT loopback, not the game server)
//
// MOTD is fetched on the PLAYER PC. Never send 127.0.0.1 / localhost.
// Set fnweb_public_host to the panel LAN IP. fnweb_host is sync-only
// (HLDS → local panel) and stays 127.0.0.1 — it is NOT a MOTD fallback.
//
// Identity lives in a short path with a .htm suffix and no query string:
//   http://<lan-ip>:8080/m/b/0-0-123456.htm
//   missions: http://<lan-ip>:8080/m/b/0-0-123456/missions.htm
//
// Page codes: p profile, b battlepass, t top, a achievements,
// v vip, e events, r tournament.
// i retired (Worker still aliases /m/i/). s/o retired (store/models).
// Missions use b + /missions.htm. OpenPage refuses store/shop/skins/cosmetics/models.
//
// Panel base URL comes from the freenova_sync cvar "fnweb_url". Callers
// fall back to a local MOTD/menu when this returns false.

#define FNWEB_MAX_URL 96
#define FNWEB_MOTD_COOLDOWN 0.40

stock FNWeb_PageCode(const szPage[])
{
    if (equal(szPage, "pass") || equal(szPage, "bp") || equal(szPage, "battlepass"))
        return 'b'
    if (equal(szPage, "top") || equal(szPage, "top15") || equal(szPage, "topcoins")
        || equal(szPage, "leaderboard") || equal(szPage, "leaderboards") || equal(szPage, "rankings"))
        return 't'
    if (equal(szPage, "missions") || equal(szPage, "mission"))
        return 'b'
    if (equal(szPage, "achievements") || equal(szPage, "records") || equal(szPage, "hof") || equal(szPage, "halloffame"))
        return 'a'
    if (equal(szPage, "store") || equal(szPage, "shop") || equal(szPage, "skins") || equal(szPage, "cosmetics"))
        return 's'
    if (equal(szPage, "vip"))
        return 'v'
    if (equal(szPage, "models"))
        return 'o'
    if (equal(szPage, "events"))
        return 'e'
    if (equal(szPage, "tournament") || equal(szPage, "ctop") || equal(szPage, "pts") || equal(szPage, "cmissions"))
        return 'r'
    return 'p'
}

stock bool:FNWeb_IsPendingAuth(const szAuth[])
{
    return equal(szAuth, "STEAM_ID_PENDING") || equal(szAuth, "STEAM_ID_LAN")
        || equal(szAuth, "VALVE_ID_PENDING") || equal(szAuth, "VALVE_ID_LAN")
        || equal(szAuth, "UNKNOWN") || equal(szAuth, "BOT") || equal(szAuth, "HLTV")
        || equal(szAuth, "PENDING") || !szAuth[0]
}

// Low Performance Mode is a persistent player preference. When it is on,
// every rich MOTD is declined here so the calling plugin runs its native
// in-game fallback instead. The fallback is still responsible for its own
// data; this helper only prevents the web panel from opening.
stock bool:FNWeb_LowPerf(id)
{
    if (!(1 <= id <= MaxClients) || !is_user_connected(id))
        return false
    if (!fnpref_is_loaded(id))
        return false
    return fnpref_get(id, FNPREF_LOW_PERF) ? true : false
}

stock FNWeb_SteamShort(const szAuth[], szOut[], iLen)
{
    if (equali(szAuth, "STEAM_", 6))
        copy(szOut, iLen, szAuth[6])
    else
        copy(szOut, iLen, szAuth)
    replace_all(szOut, iLen, ":", "-")
}

stock FNWeb_CopyHost(const szUrlOrHost[], szHost[], iLen)
{
    szHost[0] = 0
    new i = 0
    if (equali(szUrlOrHost, "http://", 7))
        i = 7
    else if (equali(szUrlOrHost, "https://", 8))
        i = 8

    new j = 0
    while (szUrlOrHost[i] && szUrlOrHost[i] != '/' && szUrlOrHost[i] != ':' && j < iLen)
        szHost[j++] = szUrlOrHost[i++]
    szHost[j] = 0
}

stock FNWeb_ExtractUrlPort(const szUrl[], szPort[], iLen)
{
    copy(szPort, iLen, "8080")
    new i = 0
    if (equali(szUrl, "http://", 7))
        i = 7
    else if (equali(szUrl, "https://", 8))
        i = 8

    while (szUrl[i] && szUrl[i] != '/' && szUrl[i] != ':')
        i++
    if (szUrl[i] != ':')
        return

    i++
    new j = 0
    while (szUrl[i] && szUrl[i] != '/' && j < iLen)
        szPort[j++] = szUrl[i++]
    szPort[j] = 0
    if (!szPort[0])
        copy(szPort, iLen, "8080")
}

stock bool:FNWeb_IsLoopbackHost(const szUrlOrHost[])
{
    new szHost[64]
    FNWeb_CopyHost(szUrlOrHost, szHost, charsmax(szHost))
    if (!szHost[0])
        copy(szHost, charsmax(szHost), szUrlOrHost)
    return equal(szHost, "127.0.0.1") || equali(szHost, "localhost")
}

stock FNWeb_SanitizeBase(szBase[], iLen)
{
    trim(szBase)
    new iEnd = strlen(szBase)
    while (iEnd > 0 && szBase[iEnd - 1] == '/')
    {
        szBase[iEnd - 1] = 0
        iEnd--
    }

    // GoldSrc MOTD fetches from the CLIENT. 127.0.0.1 is the player's PC,
    // not HLDS. Rewrite only from fnweb_public_host — never from fnweb_host
    // (that cvar is the HLDS→panel sync address and defaults to loopback).
    if (!FNWeb_IsLoopbackHost(szBase))
        return

    new szPublic[64]
    get_cvar_string("fnweb_public_host", szPublic, charsmax(szPublic))
    trim(szPublic)

    new szPublicHost[64]
    FNWeb_CopyHost(szPublic, szPublicHost, charsmax(szPublicHost))
    if (!szPublicHost[0])
        copy(szPublicHost, charsmax(szPublicHost), szPublic)

    if (!szPublicHost[0] || FNWeb_IsLoopbackHost(szPublicHost) || equal(szPublicHost, "0.0.0.0"))
        return

    new szPort[8]
    FNWeb_ExtractUrlPort(szBase, szPort, charsmax(szPort))
    formatex(szBase, iLen, "http://%s:%s", szPublicHost, szPort)
}

stock bool:FNWeb_BuildUrlFromAuth(const szAuth[], const szPage[], szUrl[], iLen)
{
    szUrl[0] = 0
    // fnweb_enabled 0 = all game MOTDs render natively with the FN theme.
    if (!get_cvar_num("fnweb_enabled"))
        return false
    if (FNWeb_IsPendingAuth(szAuth))
        return false

    new szBase[80]
    get_cvar_string("fnweb_url", szBase, charsmax(szBase))
    if (!szBase[0])
        return false
    if (containi(szBase, "https://") != -1)
        return false

    FNWeb_SanitizeBase(szBase, charsmax(szBase))
    if (!szBase[0])
        return false

    new szSteamShort[24]
    FNWeb_SteamShort(szAuth, szSteamShort, charsmax(szSteamShort))
    if (!szSteamShort[0])
        return false

    new szCode[2]
    szCode[0] = FNWeb_PageCode(szPage)
    szCode[1] = 0

    // .htm is required: GoldSrc's IE MOTD rejects extension-less HTTP URLs
    // with the same -102 it uses for over-length URLs.
    // Missions keep code b but need the extra /missions.htm tab segment.
    if (equal(szPage, "missions") || equal(szPage, "mission"))
        formatex(szUrl, iLen, "%s/m/b/%s/missions.htm", szBase, szSteamShort)
    else
        formatex(szUrl, iLen, "%s/m/%s/%s.htm", szBase, szCode, szSteamShort)

    if (FNWeb_IsLoopbackHost(szUrl))
    {
        log_amx("[FreeNova][MOTD][ERROR] refusing loopback MOTD url=%s set fnweb_public_host to the LAN IP of the panel", szUrl)
        szUrl[0] = 0
        return false
    }
    return true
}

stock bool:FNWeb_BuildUrl(id, const szPage[], szUrl[], iLen)
{
    if (!(1 <= id <= MaxClients) || !is_user_connected(id))
        return false
    if (FNWeb_LowPerf(id))
        return false

    new szAuth[40]
    get_user_authid(id, szAuth, charsmax(szAuth))
    return FNWeb_BuildUrlFromAuth(szAuth, szPage, szUrl, iLen)
}

stock bool:FNWeb_Dispatch(id, const szUrl[], const szPage[])
{
    if (!get_cvar_num("fnweb_enabled"))
        return false
    if (FNWeb_LowPerf(id))
        return false

    if (FNWeb_IsLoopbackHost(szUrl))
    {
        log_amx("[FreeNova][MOTD][ERROR] refusing loopback MOTD url=%s set fnweb_public_host to the LAN IP of the panel", szUrl)
        return false
    }

    new iLen = strlen(szUrl)
    if (iLen < 12 || iLen > FNWEB_MAX_URL)
    {
        log_amx("[FreeNova MOTD] refused page=%s len=%d url=%s", szPage, iLen, szUrl)
        return false
    }

    static Float:s_fLast[33]
    new Float:fNow = get_gametime()
    // Cooldown must return false. Returning true made callers skip the
    // local HTML fallback and look like a successful MOTD that never opened.
    if (id >= 1 && id < 33 && (fNow - s_fLast[id]) < FNWEB_MOTD_COOLDOWN)
        return false
    if (id >= 1 && id < 33)
        s_fLast[id] = fNow

    if (get_cvar_num("fnweb_debug"))
        log_amx("[FreeNova MOTD] id=%d page=%s len=%d url=%s", id, szPage, iLen, szUrl)

    show_motd(id, szUrl, "FreeNova")
    return true
}

stock bool:FNWeb_OpenPage(id, const szPage[])
{
    if (equal(szPage, "store") || equal(szPage, "shop") || equal(szPage, "skins")
        || equal(szPage, "cosmetics") || equal(szPage, "models"))
        return false

    new szUrl[FNWEB_MAX_URL + 8]
    if (!FNWeb_BuildUrl(id, szPage, szUrl, charsmax(szUrl)))
        return false
    return FNWeb_Dispatch(id, szUrl, szPage)
}

stock bool:FNWeb_OpenTarget(id, iTarget, const szPage[])
{
    if (equal(szPage, "store") || equal(szPage, "shop") || equal(szPage, "skins")
        || equal(szPage, "cosmetics") || equal(szPage, "models"))
        return false

    if (!(1 <= iTarget <= MaxClients) || !is_user_connected(iTarget))
        return FNWeb_OpenPage(id, szPage)

    new szAuth[40]
    get_user_authid(iTarget, szAuth, charsmax(szAuth))

    new szUrl[FNWEB_MAX_URL + 8]
    if (!FNWeb_BuildUrlFromAuth(szAuth, szPage, szUrl, charsmax(szUrl)))
        return false
    return FNWeb_Dispatch(id, szUrl, szPage)
}

stock FNWeb_NotifyUnavailable(id)
{
    client_print_color(id, print_team_default,
        "^4[FreeNova]^1 Could not open the web panel. Showing the in-game version.")
}
