#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <csx>
#include <hamsandwich>
#include <nvault>
#include <crxranks>
#include <crxranks_const>
#include <menabp>
#include <freenova_vip>
#include <rsu>
#include <freenova_ui>
#include <freenova_web>
#include <freenova_missions>
#include <freenova_achievements>

native fn_hub_open(id)

#define PLUGIN  "FreeNova Missions"
#define VERSION "1.1.0"
#define AUTHOR  "FreeNova"

#define TASK_LATELOAD  55000
// Global ticker. 55100 is advanced_bans TASK_KICK (client+55100). remove_task(55100) cancelled a slot-1 ban kick.
#define TASK_PERIOD    56500
#define MAX_PLAYERS    32

#define MISSION_KILLS       15
#define MISSION_HEADSHOTS   3
#define MISSION_BOMB_PLANT  2
#define MISSION_BOMB_DEFUSE 1
#define MISSION_ROUND_WIN   2
#define MISSION_XP_BONUS    500

#define WEEKLY_KILLS        100
#define WEEKLY_HEADSHOTS    25
#define WEEKLY_BOMB_PLANT   10
#define WEEKLY_ROUND_WIN    15
#define WEEKLY_XP_BONUS     5000
#define WEEKLY_COINS_BONUS  1000

#define DAILY2_STREAK        5
#define DAILY2_DAMAGE        500
#define DAILY2_SURVIVE       3
#define DAILY2_STREAK_COINS  150
#define DAILY2_DAMAGE_COINS  100
#define DAILY2_SURVIVE_COINS 100

new g_VaultBP = INVALID_HANDLE
new bool:g_bPaused
new bool:g_bLoaded[MAX_PLAYERS + 1]

new g_iMissionKills[MAX_PLAYERS + 1]
new g_iMissionHS[MAX_PLAYERS + 1]
new g_iMissionPlants[MAX_PLAYERS + 1]
new g_iMissionDefuses[MAX_PLAYERS + 1]
new g_iMissionWins[MAX_PLAYERS + 1]
new bool:g_bMissionComplete[MAX_PLAYERS + 1]

new g_iWeeklyKills[MAX_PLAYERS + 1]
new g_iWeeklyHS[MAX_PLAYERS + 1]
new g_iWeeklyPlants[MAX_PLAYERS + 1]
new g_iWeeklyWins[MAX_PLAYERS + 1]
new bool:g_bWeeklyComplete[MAX_PLAYERS + 1]

new g_iDailyStreak[MAX_PLAYERS + 1]
new g_iDailyStreakBest[MAX_PLAYERS + 1]
new g_iDailyDamage[MAX_PLAYERS + 1]
new g_iDailySurvives[MAX_PLAYERS + 1]
new bool:g_bDaily2Paid[3][MAX_PLAYERS + 1]

new g_iMissionDay[MAX_PLAYERS + 1]
new g_szMissionWeek[MAX_PLAYERS + 1][8]

#define ST_ACTIVE     0
#define ST_CLAIMABLE  1
#define ST_CLAIMED    2

#define GRP_DAILY  0
#define GRP_BONUS  1
#define GRP_WEEKLY 2
#define GRP_VIP    3

new g_iDailyTarget[5][MAX_PLAYERS + 1]
new g_iBonusTarget[3][MAX_PLAYERS + 1]
new g_iWeeklyTarget[4][MAX_PLAYERS + 1]
new g_iDailyStatus[5][MAX_PLAYERS + 1]
new g_iBonusStatus[3][MAX_PLAYERS + 1]
new g_iWeeklyStatus[4][MAX_PLAYERS + 1]
new g_iVipProgress[MAX_PLAYERS + 1]
new g_iVipTarget[MAX_PLAYERS + 1]
new g_iVipStatus[MAX_PLAYERS + 1]
new g_iRerollsUsed[MAX_PLAYERS + 1]
new g_iTrackGroup[MAX_PLAYERS + 1]
new g_iTrackSlot[MAX_PLAYERS + 1]
new bool:g_bClaiming[MAX_PLAYERS + 1]

new const g_iDailyPool[5][4] = {
	{10, 15, 25, 40},
	{2, 3, 6, 10},
	{1, 2, 3, 5},
	{1, 1, 2, 3},
	{1, 2, 4, 6}
}
new const g_iBonusPool[3][4] = {
	{3, 5, 8, 10},
	{300, 500, 1000, 2000},
	{2, 3, 5, 8}
}
new const g_iWeeklyPool[4][4] = {
	{70, 100, 150, 200},
	{15, 25, 40, 60},
	{6, 10, 15, 20},
	{10, 15, 25, 40}
}

public plugin_natives()
{
	register_library("freenova_missions")
	set_native_filter("FnmsnNativeFilter")
	register_native("fnmsn_is_complete", "native_is_complete")
	register_native("fnmsn_get_daily_progress", "native_get_daily")
	register_native("fnmsn_get_daily2_progress", "native_get_daily2")
	register_native("fnmsn_get_weekly_progress", "native_get_weekly")
	register_native("fnmsn_get_daily_done", "native_daily_done")
	register_native("fnmsn_get_bonus_done", "native_bonus_done")
	register_native("fnmsn_get_weekly_done", "native_weekly_done")
	register_native("fnmsn_show", "native_show")
	register_native("fnmsn_claim", "native_claim")
	register_native("fnmsn_reroll", "native_reroll")
	register_native("fnmsn_get_rerolls_left", "native_rerolls_left")
	register_native("fnmsn_get_status", "native_get_status")
	register_native("fnmsn_get_target", "native_get_target")
	register_native("fnmsn_set_track", "native_set_track")
	register_native("fnmsn_get_track", "native_get_track")
	register_native("fnmsn_get_vip_progress", "native_vip_progress")
	register_native("fnmsn_claim_all", "native_claim_all")
}

public FnmsnNativeFilter(const name[], index, trap)
{
	if (equal(name, "menabp_add_coins")
		|| equal(name, "menabp_add_coins_once")
		|| equal(name, "menabp_add_xp_once")
		|| equal(name, "menabp_is_ready")
		|| equal(name, "menabp_get_coins")
		|| equal(name, "fn_hub_open")
		|| equal(name, "fnach_get_count")
		|| equal(name, "fnach_show")
		|| equal(name, "fnvip_get_tier"))
		return PLUGIN_HANDLED
	return PLUGIN_CONTINUE
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)

	if (LibraryExists("rsu_missions", LibType_Library))
	{
		g_bPaused = true
		log_amx("[FreeNova] rsu_missions loaded — pausing fnmsn grants")
	}

	g_VaultBP = nvault_open("freenova_bp")
	if (g_VaultBP == INVALID_HANDLE)
		log_amx("[FreeNova] missions: nvault freenova_bp failed to open")

	register_clcmd("say /missions", "Cmd_Missions")
	register_clcmd("say_team /missions", "Cmd_Missions")
	register_clcmd("say /daily", "Cmd_Missions")
	register_clcmd("say_team /daily", "Cmd_Missions")
	register_clcmd("say /weekly", "Cmd_Missions")
	register_clcmd("say_team /weekly", "Cmd_Missions")
	register_clcmd("say /mission", "Cmd_Missions")
	register_clcmd("say_team /mission", "Cmd_Missions")
	register_clcmd("say /rsumissions", "Cmd_Missions")
	register_clcmd("say_team /rsumissions", "Cmd_Missions")

	register_logevent("Event_RoundEnd", 2, "1=Round_End")
	RegisterHam(Ham_TakeDamage, "player", "Ham_TakeDamage_Pre")
	set_task(45.0, "Task_PeriodTick", TASK_PERIOD, "", 0, "b")
}

public Task_PeriodTick()
{
	new iPlayers[32], iNum
	get_players(iPlayers, iNum, "ch")
	for (new i; i < iNum; i++)
	{
		new id = iPlayers[i]
		if (!g_bLoaded[id])
			continue
		EnsureMissionPeriod(id)
		// Retry parked VIP auto-claims. A deposit that failed because the
		// wallet was not ready (menabp_is_ready false) leaves the slot
		// ST_CLAIMABLE; re-attempt once the wallet is live so the reward is
		// never lost for the session. Gated on wallet-ready so we never
		// re-hit the weekly "could not be paid" notice in a down-wallet loop.
		if (IsVipAuto(id) && LibraryExists("menabp", LibType_Library) && menabp_is_ready(id))
			TryAutoClaimAll(id)
	}
}

public plugin_end()
{
	remove_task(TASK_PERIOD)
		// freenova_bp is a shared global nVault handle. battlepass_core is the
	// sole closer; consumer closes here raced it at map end (Invalid vault id).
}

public client_putinserver(id)
{
	ResetClient(id)
	if (is_user_bot(id))
		return
	new szAuth[40]
	get_user_authid(id, szAuth, charsmax(szAuth))
	if (!szAuth[0] || equal(szAuth, "STEAM_ID_PENDING") || equal(szAuth, "UNKNOWN"))
	{
		set_task(5.0, "Task_LateLoad", id + TASK_LATELOAD)
		return
	}
	DoLoad(id)
}

public Task_LateLoad(taskid)
{
	new id = taskid - TASK_LATELOAD
	if (!is_user_connected(id) || is_user_bot(id))
		return
	new szAuth[40]
	get_user_authid(id, szAuth, charsmax(szAuth))
	if (!szAuth[0] || equal(szAuth, "STEAM_ID_PENDING") || equal(szAuth, "UNKNOWN"))
	{
		set_task(3.0, "Task_LateLoad", id + TASK_LATELOAD)
		return
	}
	DoLoad(id)
}

public client_disconnected(id)
{
	remove_task(id + TASK_LATELOAD)
	if (g_bLoaded[id] && !is_user_bot(id))
	{
		SaveDailyMissions(id)
		SaveWeeklyMissions(id)
		SaveDaily2(id)
		SaveRoll(id)
	}
	ResetClient(id)
}

ResetClient(id)
{
	g_bLoaded[id] = false
	g_iMissionKills[id] = 0
	g_iMissionHS[id] = 0
	g_iMissionPlants[id] = 0
	g_iMissionDefuses[id] = 0
	g_iMissionWins[id] = 0
	g_bMissionComplete[id] = false
	g_iWeeklyKills[id] = 0
	g_iWeeklyHS[id] = 0
	g_iWeeklyPlants[id] = 0
	g_iWeeklyWins[id] = 0
	g_bWeeklyComplete[id] = false
	g_iDailyStreak[id] = 0
	g_iDailyStreakBest[id] = 0
	g_iDailyDamage[id] = 0
	g_iDailySurvives[id] = 0
	g_bDaily2Paid[0][id] = false
	g_bDaily2Paid[1][id] = false
	g_bDaily2Paid[2][id] = false
	g_iMissionDay[id] = 0
	g_szMissionWeek[id][0] = 0
	g_iVipProgress[id] = 0
	g_iVipTarget[id] = 20
	g_iVipStatus[id] = ST_ACTIVE
	g_iRerollsUsed[id] = 0
	g_iTrackGroup[id] = -1
	g_iTrackSlot[id] = 0
	g_bClaiming[id] = false
	for (new i; i < 5; i++)
	{
		g_iDailyTarget[i][id] = 0
		g_iDailyStatus[i][id] = ST_ACTIVE
	}
	for (new i; i < 3; i++)
	{
		g_iBonusTarget[i][id] = 0
		g_iBonusStatus[i][id] = ST_ACTIVE
	}
	for (new i; i < 4; i++)
	{
		g_iWeeklyTarget[i][id] = 0
		g_iWeeklyStatus[i][id] = ST_ACTIVE
	}
}

DoLoad(id)
{
	LoadDailyMissions(id)
	LoadWeeklyMissions(id)
	LoadDaily2(id)
	g_bLoaded[id] = true
	EnsureRoll(id)
	CheckDailyMissions(id)
	CheckWeeklyMissions(id)
	CheckDaily2(id)
	TryAutoClaimAll(id)
}

GetVaultKey(id, output[], len, const prefix[])
{
	new authid[40]
	get_user_authid(id, authid, charsmax(authid))
	for (new i = 0; authid[i]; i++)
	{
		if (authid[i] == ':')
			authid[i] = '_'
	}
	if (equal(prefix, "weekly"))
	{
		new szWeek[8]
		format_time(szWeek, charsmax(szWeek), "%G-%V")
		formatex(output, len, "%s#%s#%s", prefix, szWeek, authid)
		return
	}
	if (equal(prefix, "daily") || equal(prefix, "daily2") || equal(prefix, "roll"))
	{
		new szDay[12]
		format_time(szDay, charsmax(szDay), "%Y%m%d")
		formatex(output, len, "%s#%s#%s", prefix, szDay, authid)
		return
	}
	formatex(output, len, "%s#%s", prefix, authid)
}

EnsureMissionPeriod(id)
{
	if (!ValidId(id) || is_user_bot(id) || !g_bLoaded[id])
		return
	new szDay[12], iDay
	format_time(szDay, charsmax(szDay), "%Y%m%d")
	iDay = str_to_num(szDay)
	new szWeek[8]
	format_time(szWeek, charsmax(szWeek), "%G-%V")
	if (g_iMissionDay[id] == iDay && equal(g_szMissionWeek[id], szWeek))
		return
	if (g_iMissionDay[id] != iDay)
	{
		LoadDailyMissions(id)
		LoadDaily2(id)
		g_iDailyStreak[id] = 0
		g_iRerollsUsed[id] = 0
		g_iVipProgress[id] = 0
		g_iVipStatus[id] = ST_ACTIVE
		EnsureRoll(id)
	}
	if (!equal(g_szMissionWeek[id], szWeek))
	{
		LoadWeeklyMissions(id)
		EnsureRoll(id)
	}
}

LoadDailyMissions(id)
{
	g_iMissionKills[id] = 0
	g_iMissionHS[id] = 0
	g_iMissionPlants[id] = 0
	g_iMissionDefuses[id] = 0
	g_iMissionWins[id] = 0
	g_bMissionComplete[id] = false
	if (g_VaultBP != INVALID_HANDLE)
	{
		new key[64], value[64]
		GetVaultKey(id, key, charsmax(key), "daily")
		if (nvault_get(g_VaultBP, key, value, charsmax(value)))
		{
			new part[16], left[64]
			copy(left, charsmax(left), value)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iMissionKills[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iMissionHS[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iMissionPlants[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iMissionDefuses[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iMissionWins[id] = str_to_num(part)
			g_bMissionComplete[id] = bool:str_to_num(left)
		}
	}
	new szDay[12]
	format_time(szDay, charsmax(szDay), "%Y%m%d")
	g_iMissionDay[id] = str_to_num(szDay)
}

SaveDailyMissions(id)
{
	if (g_VaultBP == INVALID_HANDLE || !g_bLoaded[id])
		return
	new key[64], value[64]
	GetVaultKey(id, key, charsmax(key), "daily")
	formatex(value, charsmax(value), "%d %d %d %d %d %d",
		g_iMissionKills[id], g_iMissionHS[id], g_iMissionPlants[id],
		g_iMissionDefuses[id], g_iMissionWins[id], _:g_bMissionComplete[id])
	nvault_set(g_VaultBP, key, value)
}

LoadWeeklyMissions(id)
{
	g_iWeeklyKills[id] = 0
	g_iWeeklyHS[id] = 0
	g_iWeeklyPlants[id] = 0
	g_iWeeklyWins[id] = 0
	g_bWeeklyComplete[id] = false
	if (g_VaultBP != INVALID_HANDLE)
	{
		new key[64], value[64]
		GetVaultKey(id, key, charsmax(key), "weekly")
		if (nvault_get(g_VaultBP, key, value, charsmax(value)))
		{
			new part[16], left[64]
			copy(left, charsmax(left), value)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iWeeklyKills[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iWeeklyHS[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iWeeklyPlants[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iWeeklyWins[id] = str_to_num(part)
			g_bWeeklyComplete[id] = bool:str_to_num(left)
		}
	}
	format_time(g_szMissionWeek[id], charsmax(g_szMissionWeek[]), "%G-%V")
}

SaveWeeklyMissions(id)
{
	if (g_VaultBP == INVALID_HANDLE || !g_bLoaded[id])
		return
	new key[64], value[64]
	GetVaultKey(id, key, charsmax(key), "weekly")
	formatex(value, charsmax(value), "%d %d %d %d %d",
		g_iWeeklyKills[id], g_iWeeklyHS[id], g_iWeeklyPlants[id],
		g_iWeeklyWins[id], _:g_bWeeklyComplete[id])
	nvault_set(g_VaultBP, key, value)
}

LoadDaily2(id)
{
	g_iDailyStreakBest[id] = 0
	g_iDailyDamage[id] = 0
	g_iDailySurvives[id] = 0
	g_bDaily2Paid[0][id] = false
	g_bDaily2Paid[1][id] = false
	g_bDaily2Paid[2][id] = false
	if (g_VaultBP != INVALID_HANDLE)
	{
		new key[64], value[64]
		GetVaultKey(id, key, charsmax(key), "daily2")
		if (nvault_get(g_VaultBP, key, value, charsmax(value)))
		{
			new part[16], left[64]
			copy(left, charsmax(left), value)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iDailyStreakBest[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iDailyDamage[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_iDailySurvives[id] = str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_bDaily2Paid[0][id] = bool:str_to_num(part)
			strtok(left, part, charsmax(part), left, charsmax(left), ' ')
			g_bDaily2Paid[1][id] = bool:str_to_num(part)
			g_bDaily2Paid[2][id] = bool:str_to_num(left)
		}
	}
}

SaveDaily2(id)
{
	if (g_VaultBP == INVALID_HANDLE || !g_bLoaded[id])
		return
	new key[64], value[64]
	GetVaultKey(id, key, charsmax(key), "daily2")
	formatex(value, charsmax(value), "%d %d %d %d %d %d",
		g_iDailyStreakBest[id], g_iDailyDamage[id], g_iDailySurvives[id],
		_:g_bDaily2Paid[0][id], _:g_bDaily2Paid[1][id], _:g_bDaily2Paid[2][id])
	nvault_set(g_VaultBP, key, value)
}

AddCoins(id, amount)
{
	if (amount == 0)
		return 1
	if (!LibraryExists("menabp", LibType_Library))
		return 0
	if (amount > 0)
	{
		// Fail-safe: a deposit only counts as paid when the wallet is live
		// and the native accepted it (menabp_add_coins returns 0 while the
		// player's BP data is not loaded yet).
		if (!menabp_is_ready(id))
			return 0
		if (menabp_add_coins(id, amount) != 0)
			return 1
		return 0
	}
	new iCost = -amount
	new iBefore = menabp_get_coins(id)
	if (iBefore < iCost)
		return 0
	new iAfter = menabp_add_coins(id, amount)
	if (iAfter == 0 && menabp_get_coins(id) >= iBefore)
		return 0
	if (menabp_get_coins(id) > iBefore - iCost)
		return 0
	return 1
}

VipTier(id)
{
	if (LibraryExists("freenova_vip", LibType_Library))
		return fnvip_get_tier(id)
	return 0
}

bool:IsVipAuto(id)
{
	return VipTier(id) >= FNVIP_VIP
}

FreeRerolls(id)
{
	new t = VipTier(id)
	if (t >= FNVIP_ELITE) return 4
	if (t >= FNVIP_VIPPLUS) return 3
	if (t >= FNVIP_VIP) return 2
	return 1
}

RerollCost(id)
{
	new t = VipTier(id)
	if (t >= FNVIP_ELITE) return 100
	if (t >= FNVIP_VIPPLUS) return 150
	return 200
}

RerollsLeft(id)
{
	new left = FreeRerolls(id) - g_iRerollsUsed[id]
	return (left > 0) ? left : 0
}

DailyVal(id, slot)
{
	switch (slot)
	{
		case 0: return g_iMissionKills[id]
		case 1: return g_iMissionHS[id]
		case 2: return g_iMissionPlants[id]
		case 3: return g_iMissionDefuses[id]
		case 4: return g_iMissionWins[id]
	}
	return 0
}

BonusVal(id, slot)
{
	switch (slot)
	{
		case 0: return g_iDailyStreakBest[id]
		case 1: return g_iDailyDamage[id]
		case 2: return g_iDailySurvives[id]
	}
	return 0
}

WeeklyVal(id, slot)
{
	switch (slot)
	{
		case 0: return g_iWeeklyKills[id]
		case 1: return g_iWeeklyHS[id]
		case 2: return g_iWeeklyPlants[id]
		case 3: return g_iWeeklyWins[id]
	}
	return 0
}

ApplyMediumDefaults(id)
{
	g_iDailyTarget[0][id] = MISSION_KILLS
	g_iDailyTarget[1][id] = MISSION_HEADSHOTS
	g_iDailyTarget[2][id] = MISSION_BOMB_PLANT
	g_iDailyTarget[3][id] = MISSION_BOMB_DEFUSE
	g_iDailyTarget[4][id] = MISSION_ROUND_WIN
	g_iBonusTarget[0][id] = DAILY2_STREAK
	g_iBonusTarget[1][id] = DAILY2_DAMAGE
	g_iBonusTarget[2][id] = DAILY2_SURVIVE
	g_iWeeklyTarget[0][id] = WEEKLY_KILLS
	g_iWeeklyTarget[1][id] = WEEKLY_HEADSHOTS
	g_iWeeklyTarget[2][id] = WEEKLY_BOMB_PLANT
	g_iWeeklyTarget[3][id] = WEEKLY_ROUND_WIN
	g_iVipTarget[id] = 20
}

RollTargets(id, bool:bForce)
{
	new i, d
	if (bForce || !g_iDailyTarget[0][id])
	{
		for (i = 0; i < 5; i++)
		{
			if (!bForce && g_iDailyStatus[i][id] != ST_ACTIVE)
				continue
			d = random_num(0, 3)
			g_iDailyTarget[i][id] = g_iDailyPool[i][d]
			if (g_iDailyStatus[i][id] != ST_CLAIMED)
				g_iDailyStatus[i][id] = ST_ACTIVE
		}
	}
	if (bForce || !g_iBonusTarget[0][id])
	{
		for (i = 0; i < 3; i++)
		{
			if (!bForce && g_iBonusStatus[i][id] != ST_ACTIVE)
				continue
			d = random_num(0, 3)
			g_iBonusTarget[i][id] = g_iBonusPool[i][d]
			if (g_iBonusStatus[i][id] != ST_CLAIMED)
				g_iBonusStatus[i][id] = ST_ACTIVE
		}
	}
	if (bForce || !g_iWeeklyTarget[0][id])
	{
		for (i = 0; i < 4; i++)
		{
			if (!bForce && g_iWeeklyStatus[i][id] != ST_ACTIVE)
				continue
			d = random_num(0, 3)
			g_iWeeklyTarget[i][id] = g_iWeeklyPool[i][d]
			if (g_iWeeklyStatus[i][id] != ST_CLAIMED)
				g_iWeeklyStatus[i][id] = ST_ACTIVE
		}
	}
	if (!g_iVipTarget[id])
		g_iVipTarget[id] = 20
}

LoadRoll(id)
{
	ApplyMediumDefaults(id)
	if (g_VaultBP == INVALID_HANDLE)
		return 0
	new key[64], value[128]
	GetVaultKey(id, key, charsmax(key), "roll")
	if (!nvault_get(g_VaultBP, key, value, charsmax(value)))
		return 0
	new part[16], left[128]
	copy(left, charsmax(left), value)
	for (new i; i < 5; i++)
	{
		strtok(left, part, charsmax(part), left, charsmax(left), ' ')
		g_iDailyTarget[i][id] = str_to_num(part)
		strtok(left, part, charsmax(part), left, charsmax(left), ' ')
		g_iDailyStatus[i][id] = str_to_num(part)
	}
	for (new i; i < 3; i++)
	{
		strtok(left, part, charsmax(part), left, charsmax(left), ' ')
		g_iBonusTarget[i][id] = str_to_num(part)
		strtok(left, part, charsmax(part), left, charsmax(left), ' ')
		g_iBonusStatus[i][id] = str_to_num(part)
	}
	for (new i; i < 4; i++)
	{
		strtok(left, part, charsmax(part), left, charsmax(left), ' ')
		g_iWeeklyTarget[i][id] = str_to_num(part)
		strtok(left, part, charsmax(part), left, charsmax(left), ' ')
		g_iWeeklyStatus[i][id] = str_to_num(part)
	}
	strtok(left, part, charsmax(part), left, charsmax(left), ' ')
	g_iVipTarget[id] = str_to_num(part)
	strtok(left, part, charsmax(part), left, charsmax(left), ' ')
	g_iVipProgress[id] = str_to_num(part)
	strtok(left, part, charsmax(part), left, charsmax(left), ' ')
	g_iVipStatus[id] = str_to_num(part)
	strtok(left, part, charsmax(part), left, charsmax(left), ' ')
	g_iRerollsUsed[id] = str_to_num(part)
	return 1
}

SaveRoll(id)
{
	if (g_VaultBP == INVALID_HANDLE || !g_bLoaded[id])
		return
	new key[64], value[128]
	GetVaultKey(id, key, charsmax(key), "roll")
	formatex(value, charsmax(value), "%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d",
		g_iDailyTarget[0][id], g_iDailyStatus[0][id],
		g_iDailyTarget[1][id], g_iDailyStatus[1][id],
		g_iDailyTarget[2][id], g_iDailyStatus[2][id],
		g_iDailyTarget[3][id], g_iDailyStatus[3][id],
		g_iDailyTarget[4][id], g_iDailyStatus[4][id],
		g_iBonusTarget[0][id], g_iBonusStatus[0][id],
		g_iBonusTarget[1][id], g_iBonusStatus[1][id],
		g_iBonusTarget[2][id], g_iBonusStatus[2][id],
		g_iWeeklyTarget[0][id], g_iWeeklyStatus[0][id],
		g_iWeeklyTarget[1][id], g_iWeeklyStatus[1][id],
		g_iWeeklyTarget[2][id], g_iWeeklyStatus[2][id],
		g_iWeeklyTarget[3][id], g_iWeeklyStatus[3][id],
		g_iVipTarget[id], g_iVipProgress[id], g_iVipStatus[id], g_iRerollsUsed[id])
	nvault_set(g_VaultBP, key, value)
}

EnsureRoll(id)
{
	if (LoadRoll(id) && g_iDailyTarget[0][id] > 0)
	{
		new bool:bRepairDaily = false, bool:bRepairWeekly = false
		if (!g_bMissionComplete[id] && DailyDoneCount(id) >= 5)
		{
			g_bMissionComplete[id] = true
			bRepairDaily = true
		}
		if (!g_bWeeklyComplete[id] && WeeklyDoneCount(id) >= 4)
		{
			g_bWeeklyComplete[id] = true
			bRepairWeekly = true
		}
		if (bRepairDaily)
			SaveDailyMissions(id)
		if (bRepairWeekly)
			SaveWeeklyMissions(id)
		if (bRepairDaily || bRepairWeekly)
			SaveRoll(id)
		return
	}
	ApplyMediumDefaults(id)
	RollTargets(id, true)
	// Repair a crash window between the slot save and the completion save.
	if (!g_bMissionComplete[id] && DailyDoneCount(id) >= 5)
		g_bMissionComplete[id] = true
	if (!g_bWeeklyComplete[id] && WeeklyDoneCount(id) >= 4)
		g_bWeeklyComplete[id] = true
	if (g_bMissionComplete[id])
	{
		for (new i; i < 5; i++)
			g_iDailyStatus[i][id] = ST_CLAIMED
	}
	for (new i; i < 3; i++)
	{
		if (g_bDaily2Paid[i][id])
			g_iBonusStatus[i][id] = ST_CLAIMED
	}
	if (g_bWeeklyComplete[id])
	{
		for (new i; i < 4; i++)
			g_iWeeklyStatus[i][id] = ST_CLAIMED
	}
	SaveRoll(id)
	if (g_bMissionComplete[id])
		SaveDailyMissions(id)
	if (g_bWeeklyComplete[id])
		SaveWeeklyMissions(id)
}

MarkClaimable(id, group, slot)
{
	new iOld
	if (group == GRP_DAILY)
	{
		iOld = g_iDailyStatus[slot][id]
		if (iOld != ST_ACTIVE)
			return
		g_iDailyStatus[slot][id] = ST_CLAIMABLE
	}
	else if (group == GRP_BONUS)
	{
		iOld = g_iBonusStatus[slot][id]
		if (iOld != ST_ACTIVE)
			return
		g_iBonusStatus[slot][id] = ST_CLAIMABLE
	}
	else if (group == GRP_WEEKLY)
	{
		iOld = g_iWeeklyStatus[slot][id]
		if (iOld != ST_ACTIVE)
			return
		g_iWeeklyStatus[slot][id] = ST_CLAIMABLE
	}
	else if (group == GRP_VIP)
	{
		iOld = g_iVipStatus[id]
		if (iOld != ST_ACTIVE)
			return
		g_iVipStatus[id] = ST_CLAIMABLE
	}
	SaveRoll(id)
	// Single print per completed slot. For VIP auto-claim the outcome is
	// printed by DoClaim; only fall back to the "ready to claim" notice when
	// the auto-claim did not run or did not pay (wallet not ready). This
	// removes the old double path where l.767 printed "ready to claim" AND
	// DoClaim printed "slot claimed" for the same slot in one event.
	if (IsVipAuto(id) && DoClaim(id, group, slot))
		return
	client_printcolor(id, "!g[FreeNova] !n Mission ready to claim. Open /missions.")
}

bool:DoClaim(id, group, slot)
{
	if (g_bPaused || !g_bLoaded[id] || g_bClaiming[id])
		return false
	// Coins and BP XP are both owned by battlepass_core. Fail closed until
	// the player's BP ledger is ready instead of marking a slot claimed.
	if (!LibraryExists("menabp", LibType_Library) || !menabp_is_ready(id))
	{
		client_printcolor(id, "!g[FreeNova] !n BattlePass is still loading - try again shortly.")
		return false
	}
	g_bClaiming[id] = true
	new bool:bOk = false
	if (group == GRP_DAILY && slot >= 0 && slot < 5 && g_iDailyStatus[slot][id] == ST_CLAIMABLE)
	{
		// The fifth claim completes the daily set. Pay BP XP before the slot
		// is marked claimed so a not-ready ledger can be retried safely.
		new bool:bCompletes = (DailyDoneCount(id) + 1 >= 5 && !g_bMissionComplete[id])
		new iXpAdded = 0
		if (bCompletes)
		{
			new szDay[12], szAward[64]
			format_time(szDay, charsmax(szDay), "%Y%m%d")
			formatex(szAward, charsmax(szAward), "daily_complete#%s", szDay)
			iXpAdded = menabp_add_xp_once(id, MISSION_XP_BONUS, szAward)
			if (iXpAdded < 0)
			{
				g_bClaiming[id] = false
				client_printcolor(id, "!g[FreeNova] !n BattlePass XP could not be paid yet - try again shortly.")
				return false
			}
		}
		g_iDailyStatus[slot][id] = ST_CLAIMED
		SaveRoll(id)
		if (bCompletes)
		{
			g_bMissionComplete[id] = true
			SaveDailyMissions(id)
			if (iXpAdded > 0)
				client_printcolor(id, "!g[FreeNova] !n Daily Missions Complete! +!g%d BP XP !n", iXpAdded)
			else
				client_printcolor(id, "!g[FreeNova] !n Daily Missions Complete!")
		}
		else
			client_printcolor(id, "!g[FreeNova] !n Daily slot claimed.")
		g_bClaiming[id] = false
		return true
	}
	if (group == GRP_BONUS && slot >= 0 && slot < 3 && g_iBonusStatus[slot][id] == ST_CLAIMABLE)
	{
		new iPay = (slot == 0) ? DAILY2_STREAK_COINS : ((slot == 1) ? DAILY2_DAMAGE_COINS : DAILY2_SURVIVE_COINS)
		if (!g_bDaily2Paid[slot][id])
		{
			if (!AddCoins(id, iPay))
			{
				g_bClaiming[id] = false
				return false
			}
		}
		else
			iPay = 0
		g_iBonusStatus[slot][id] = ST_CLAIMED
		g_bDaily2Paid[slot][id] = true
		SaveDaily2(id)
		SaveRoll(id)
		g_bClaiming[id] = false
		if (iPay)
			client_printcolor(id, "!g[FreeNova] !n Bonus mission claimed! +!g%d Coins !n", iPay)
		else
			client_printcolor(id, "!g[FreeNova] !n Bonus mission claimed.")
		return true
	}
	if (group == GRP_WEEKLY && slot >= 0 && slot < 4 && g_iWeeklyStatus[slot][id] == ST_CLAIMABLE)
	{
		// The fourth claim completes the weekly set. Both rewards are keyed
		// per ISO week, so a partial payout can be retried without duplication.
		new bool:bCompletes = (WeeklyDoneCount(id) + 1 >= 4 && !g_bWeeklyComplete[id])
		new iXpAdded = 0, iCoinBalance = 0
		if (bCompletes)
		{
			new szWeek[8], szXpAward[64], szCoinAward[64]
			format_time(szWeek, charsmax(szWeek), "%G-%V")
			formatex(szXpAward, charsmax(szXpAward), "weekly_xp#%s", szWeek)
			formatex(szCoinAward, charsmax(szCoinAward), "weekly_coins#%s", szWeek)
			iXpAdded = menabp_add_xp_once(id, WEEKLY_XP_BONUS, szXpAward)
			if (iXpAdded < 0)
			{
				g_bClaiming[id] = false
				client_printcolor(id, "!g[FreeNova] !n BattlePass XP could not be paid yet - try again shortly.")
				return false
			}
			iCoinBalance = menabp_add_coins_once(id, WEEKLY_COINS_BONUS, szCoinAward)
			if (iCoinBalance < 0)
			{
				g_bClaiming[id] = false
				client_printcolor(id, "!g[FreeNova] !n Weekly coins could not be paid yet - try again shortly.")
				return false
			}
		}
		g_iWeeklyStatus[slot][id] = ST_CLAIMED
		SaveRoll(id)
		if (bCompletes)
		{
			g_bWeeklyComplete[id] = true
			SaveWeeklyMissions(id)
			if (iXpAdded > 0 && iCoinBalance > 0)
				client_printcolor(id, "!g[FreeNova] !n Weekly Missions Complete! +!g%d BP XP !n, +!g%d Coins !n", iXpAdded, WEEKLY_COINS_BONUS)
			else if (iXpAdded > 0)
				client_printcolor(id, "!g[FreeNova] !n Weekly Missions Complete! +!g%d BP XP !n", iXpAdded)
			else if (iCoinBalance > 0)
				client_printcolor(id, "!g[FreeNova] !n Weekly Missions Complete! +!g%d Coins !n", WEEKLY_COINS_BONUS)
			else
				client_printcolor(id, "!g[FreeNova] !n Weekly Missions Complete!")
		}
		else
			client_printcolor(id, "!g[FreeNova] !n Weekly slot claimed.")
		g_bClaiming[id] = false
		return true
	}
	if (group == GRP_VIP && g_iVipStatus[id] == ST_CLAIMABLE && VipTier(id) >= FNVIP_VIP)
	{
		if (!AddCoins(id, 150))
		{
			g_bClaiming[id] = false
			return false
		}
		g_iVipStatus[id] = ST_CLAIMED
		SaveRoll(id)
		g_bClaiming[id] = false
		client_printcolor(id, "!g[FreeNova] !n VIP extra claimed! +!g150 Coins !n")
		return true
	}
	g_bClaiming[id] = false
	return bOk
}

ClaimAllReady(id)
{
	new i, n
	for (i = 0; i < 5; i++)
		if (g_iDailyStatus[i][id] == ST_CLAIMABLE && DoClaim(id, GRP_DAILY, i)) n++
	for (i = 0; i < 3; i++)
		if (g_iBonusStatus[i][id] == ST_CLAIMABLE && DoClaim(id, GRP_BONUS, i)) n++
	for (i = 0; i < 4; i++)
		if (g_iWeeklyStatus[i][id] == ST_CLAIMABLE && DoClaim(id, GRP_WEEKLY, i)) n++
	if (g_iVipStatus[id] == ST_CLAIMABLE && VipTier(id) >= FNVIP_VIP && DoClaim(id, GRP_VIP, 0))
		n++
	return n
}

TryAutoClaimAll(id)
{
	if (!IsVipAuto(id))
		return
	ClaimAllReady(id)
}

DoReroll(id, slot)
{
	if (g_bPaused || !g_bLoaded[id] || slot < 0 || slot > 4)
		return 0
	if (g_iDailyStatus[slot][id] != ST_ACTIVE)
		return -1
	new iLeft = RerollsLeft(id)
	if (iLeft <= 0)
	{
		new iCost = RerollCost(id)
		if (!AddCoins(id, -iCost))
			return -2
	}
	else
		g_iRerollsUsed[id]++
	new iOld = g_iDailyTarget[slot][id]
	new iNew, n
	for (n = 0; n < 8; n++)
	{
		iNew = g_iDailyPool[slot][random_num(0, 3)]
		if (iNew != iOld)
			break
	}
	g_iDailyTarget[slot][id] = iNew
	switch (slot)
	{
		case 0: g_iMissionKills[id] = 0
		case 1: g_iMissionHS[id] = 0
		case 2: g_iMissionPlants[id] = 0
		case 3: g_iMissionDefuses[id] = 0
		case 4: g_iMissionWins[id] = 0
	}
	SaveDailyMissions(id)
	SaveRoll(id)
	client_printcolor(id, "!g[FreeNova] !n Daily slot rerolled. New target: !t%d!n.", iNew)
	return 1
}

CheckDailyMissions(id)
{
	if (g_bPaused || !g_bLoaded[id])
		return
	if (g_iDailyStatus[0][id] == ST_ACTIVE && DailyVal(id, 0) >= g_iDailyTarget[0][id]) MarkClaimable(id, GRP_DAILY, 0)
	if (g_iDailyStatus[1][id] == ST_ACTIVE && DailyVal(id, 1) >= g_iDailyTarget[1][id]) MarkClaimable(id, GRP_DAILY, 1)
	if (g_iDailyStatus[2][id] == ST_ACTIVE && DailyVal(id, 2) >= g_iDailyTarget[2][id]) MarkClaimable(id, GRP_DAILY, 2)
	if (g_iDailyStatus[3][id] == ST_ACTIVE && DailyVal(id, 3) >= g_iDailyTarget[3][id]) MarkClaimable(id, GRP_DAILY, 3)
	if (g_iDailyStatus[4][id] == ST_ACTIVE && DailyVal(id, 4) >= g_iDailyTarget[4][id]) MarkClaimable(id, GRP_DAILY, 4)
}

CheckWeeklyMissions(id)
{
	if (g_bPaused || !g_bLoaded[id])
		return
	if (g_iWeeklyStatus[0][id] == ST_ACTIVE && WeeklyVal(id, 0) >= g_iWeeklyTarget[0][id]) MarkClaimable(id, GRP_WEEKLY, 0)
	if (g_iWeeklyStatus[1][id] == ST_ACTIVE && WeeklyVal(id, 1) >= g_iWeeklyTarget[1][id]) MarkClaimable(id, GRP_WEEKLY, 1)
	if (g_iWeeklyStatus[2][id] == ST_ACTIVE && WeeklyVal(id, 2) >= g_iWeeklyTarget[2][id]) MarkClaimable(id, GRP_WEEKLY, 2)
	if (g_iWeeklyStatus[3][id] == ST_ACTIVE && WeeklyVal(id, 3) >= g_iWeeklyTarget[3][id]) MarkClaimable(id, GRP_WEEKLY, 3)
}

CheckDaily2(id)
{
	if (g_bPaused || !g_bLoaded[id])
		return
	if (g_iBonusStatus[0][id] == ST_ACTIVE && BonusVal(id, 0) >= g_iBonusTarget[0][id]) MarkClaimable(id, GRP_BONUS, 0)
	if (g_iBonusStatus[1][id] == ST_ACTIVE && BonusVal(id, 1) >= g_iBonusTarget[1][id]) MarkClaimable(id, GRP_BONUS, 1)
	if (g_iBonusStatus[2][id] == ST_ACTIVE && BonusVal(id, 2) >= g_iBonusTarget[2][id]) MarkClaimable(id, GRP_BONUS, 2)
	if (VipTier(id) >= FNVIP_VIP && g_iVipStatus[id] == ST_ACTIVE && g_iVipProgress[id] >= g_iVipTarget[id])
		MarkClaimable(id, GRP_VIP, 0)
}

bool:SlotOpen(status)
{
	return status == ST_ACTIVE
}

public fn_on_player_kill(attacker, victim, wpnindex, headshot, tk)
{
	#pragma unused victim, wpnindex
	if (g_bPaused || tk)
		return
	if (!is_user_connected(attacker) || is_user_bot(attacker) || !g_bLoaded[attacker])
		return
	if (get_cvar_num("amx_knife_round_active") == 1)
		return
	EnsureMissionPeriod(attacker)
	if (SlotOpen(g_iDailyStatus[0][attacker]))
		g_iMissionKills[attacker]++
	if (SlotOpen(g_iWeeklyStatus[0][attacker]))
		g_iWeeklyKills[attacker]++
	if (VipTier(attacker) >= FNVIP_VIP && SlotOpen(g_iVipStatus[attacker]))
	{
		g_iVipProgress[attacker]++
		SaveRoll(attacker)
	}
	if (SlotOpen(g_iBonusStatus[0][attacker]))
	{
		g_iDailyStreak[attacker]++
		if (g_iDailyStreak[attacker] > g_iDailyStreakBest[attacker])
			g_iDailyStreakBest[attacker] = g_iDailyStreak[attacker]
	}
	if (headshot)
	{
		if (SlotOpen(g_iDailyStatus[1][attacker]))
			g_iMissionHS[attacker]++
		if (SlotOpen(g_iWeeklyStatus[1][attacker]))
			g_iWeeklyHS[attacker]++
	}
	CheckDailyMissions(attacker)
	CheckWeeklyMissions(attacker)
	CheckDaily2(attacker)
}

// RANK_BOTS master switch reader: true only when rsu_core runs RANK_BOTS=1.
// Bots never load mission state, so this only opens VICTIM-side counters
// (streak reset, damage bonus) for humans. Bot PLAYERS earn nothing.
stock bool:BotCountOn()
{
    return LibraryExists("rsu_core", LibType_Library) && rsu_bots_count();
}

public client_death(attacker, victim, wpnindex, hitplace, TK)
{
	#pragma unused attacker, wpnindex, hitplace, TK
	if (is_user_connected(victim) && (!is_user_bot(victim) || BotCountOn()))
		g_iDailyStreak[victim] = 0
}

public fn_on_bomb_event(id, type)
{
	if (g_bPaused || !g_bLoaded[id])
		return
	if (get_cvar_num("amx_knife_round_active") == 1)
		return
	EnsureMissionPeriod(id)
	if (type == 0)
	{
		if (SlotOpen(g_iDailyStatus[2][id]))
			g_iMissionPlants[id]++
		if (SlotOpen(g_iWeeklyStatus[2][id]))
			g_iWeeklyPlants[id]++
		CheckDailyMissions(id)
		CheckWeeklyMissions(id)
	}
	else if (type == 1)
	{
		if (SlotOpen(g_iDailyStatus[3][id]))
			g_iMissionDefuses[id]++
		CheckDailyMissions(id)
	}
}

public fn_on_round_win(id, team)
{
	#pragma unused team
	if (g_bPaused || !g_bLoaded[id])
		return
	if (get_cvar_num("amx_knife_round_active") == 1)
		return
	EnsureMissionPeriod(id)
	if (SlotOpen(g_iDailyStatus[4][id]))
		g_iMissionWins[id]++
	if (SlotOpen(g_iWeeklyStatus[3][id]))
		g_iWeeklyWins[id]++
	CheckDailyMissions(id)
	CheckWeeklyMissions(id)
}

public Ham_TakeDamage_Pre(victim, inflictor, attacker, Float:damage, damagebits)
{
	#pragma unused inflictor, damagebits
	if (g_bPaused)
		return HAM_IGNORED
	if (attacker < 1 || attacker > MAX_PLAYERS || attacker == victim)
		return HAM_IGNORED
	if (!is_user_connected(attacker) || (is_user_bot(attacker) && !BotCountOn()) || (is_user_bot(victim) && !BotCountOn()))
		return HAM_IGNORED
	if (cs_get_user_team(attacker) == cs_get_user_team(victim))
		return HAM_IGNORED
	if (get_cvar_num("amx_knife_round_active") == 1)
		return HAM_IGNORED
	if (!g_bLoaded[attacker])
		return HAM_IGNORED
	if (!SlotOpen(g_iBonusStatus[1][attacker]))
		return HAM_IGNORED
	EnsureMissionPeriod(attacker)
	g_iDailyDamage[attacker] += floatround(damage)
	CheckDaily2(attacker)
	return HAM_IGNORED
}

public Event_RoundEnd()
{
	new survivors[32], sNum
	get_players(survivors, sNum, "ah")
	for (new s; s < sNum; s++)
	{
		new sid = survivors[s]
		if (!is_user_bot(sid) && g_bLoaded[sid] && get_cvar_num("amx_knife_round_active") != 1)
		{
			if (!SlotOpen(g_iBonusStatus[2][sid]))
				continue
			EnsureMissionPeriod(sid)
			g_iDailySurvives[sid]++
			CheckDaily2(sid)
		}
	}
}

public Cmd_Missions(id)
{
	if (!is_user_connected(id))
		return PLUGIN_HANDLED
	if (FNWeb_OpenPage(id, "missions"))
		return PLUGIN_HANDLED
	client_printcolor(id, "!g[FreeNova] !nMissions are unavailable right now - try again in a moment.")
	return PLUGIN_HANDLED
}





















bool:ValidId(id)
{
	return (1 <= id <= MAX_PLAYERS)
}

DailyDoneCount(id)
{
	new n
	for (new i; i < 5; i++)
		if (g_iDailyStatus[i][id] == ST_CLAIMED) n++
	return n
}

WeeklyDoneCount(id)
{
	new n
	for (new i; i < 4; i++)
		if (g_iWeeklyStatus[i][id] == ST_CLAIMED) n++
	return n
}

public native_is_complete(plugin, params)
{
	new id = get_param(1)
	return (ValidId(id) && g_bMissionComplete[id]) ? 1 : 0
}

public native_get_daily(plugin, params)
{
	new id = get_param(1)
	new mission = get_param(2)
	if (!ValidId(id))
		return 0
	switch (mission)
	{
		case 0: return g_iMissionKills[id]
		case 1: return g_iMissionHS[id]
		case 2: return g_iMissionPlants[id]
		case 3: return g_iMissionDefuses[id]
		case 4: return g_iMissionWins[id]
	}
	return 0
}

public native_get_daily2(plugin, params)
{
	new id = get_param(1)
	new mission = get_param(2)
	if (!ValidId(id))
		return 0
	switch (mission)
	{
		case 0: return g_iDailyStreakBest[id]
		case 1: return g_iDailyDamage[id]
		case 2: return g_iDailySurvives[id]
	}
	return 0
}

public native_get_weekly(plugin, params)
{
	new id = get_param(1)
	new mission = get_param(2)
	if (!ValidId(id))
		return 0
	switch (mission)
	{
		case 0: return g_iWeeklyKills[id]
		case 1: return g_iWeeklyHS[id]
		case 2: return g_iWeeklyPlants[id]
		case 3: return g_iWeeklyWins[id]
	}
	return 0
}

public native_daily_done(plugin, params)
{
	new id = get_param(1)
	return ValidId(id) ? DailyDoneCount(id) : 0
}

public native_bonus_done(plugin, params)
{
	new id = get_param(1)
	if (!ValidId(id))
		return 0
	new n
	for (new i; i < 3; i++)
		if (g_iBonusStatus[i][id] == ST_CLAIMED) n++
	return n
}

public native_weekly_done(plugin, params)
{
	new id = get_param(1)
	return ValidId(id) ? WeeklyDoneCount(id) : 0
}

public native_show(plugin, params)
{
	new id = get_param(1)
	if (!ValidId(id) || !is_user_connected(id))
		return 0
	if (FNWeb_OpenPage(id, "missions"))
		return 1
	return 0
}

public native_claim(plugin, params)
{
	new id = get_param(1)
	new group = get_param(2)
	new slot = get_param(3)
	if (!ValidId(id) || !g_bLoaded[id])
		return 0
	return DoClaim(id, group, slot) ? 1 : 0
}

public native_reroll(plugin, params)
{
	new id = get_param(1)
	new slot = get_param(2)
	if (!ValidId(id) || !g_bLoaded[id])
		return 0
	return (DoReroll(id, slot) == 1) ? 1 : 0
}

public native_rerolls_left(plugin, params)
{
	new id = get_param(1)
	return ValidId(id) ? RerollsLeft(id) : 0
}

public native_get_status(plugin, params)
{
	new id = get_param(1)
	new group = get_param(2)
	new slot = get_param(3)
	if (!ValidId(id))
		return 0
	if (group == GRP_DAILY && slot >= 0 && slot < 5)
		return g_iDailyStatus[slot][id]
	if (group == GRP_BONUS && slot >= 0 && slot < 3)
		return g_iBonusStatus[slot][id]
	if (group == GRP_WEEKLY && slot >= 0 && slot < 4)
		return g_iWeeklyStatus[slot][id]
	if (group == GRP_VIP)
		return g_iVipStatus[id]
	return 0
}

public native_get_target(plugin, params)
{
	new id = get_param(1)
	new group = get_param(2)
	new slot = get_param(3)
	if (!ValidId(id))
		return 0
	if (group == GRP_DAILY && slot >= 0 && slot < 5)
		return g_iDailyTarget[slot][id]
	if (group == GRP_BONUS && slot >= 0 && slot < 3)
		return g_iBonusTarget[slot][id]
	if (group == GRP_WEEKLY && slot >= 0 && slot < 4)
		return g_iWeeklyTarget[slot][id]
	if (group == GRP_VIP)
		return g_iVipTarget[id]
	return 0
}

public native_set_track(plugin, params)
{
	new id = get_param(1)
	new group = get_param(2)
	new slot = get_param(3)
	if (!ValidId(id))
		return 0
	g_iTrackGroup[id] = group
	g_iTrackSlot[id] = slot
	return 1
}

public native_get_track(plugin, params)
{
	new id = get_param(1)
	if (!ValidId(id))
		return 0
	new szOut[32]
	formatex(szOut, charsmax(szOut), "%d:%d", g_iTrackGroup[id], g_iTrackSlot[id])
	set_string(2, szOut, get_param(3))
	return 1
}

public native_vip_progress(plugin, params)
{
	new id = get_param(1)
	return ValidId(id) ? g_iVipProgress[id] : 0
}

public native_claim_all(plugin, params)
{
	new id = get_param(1)
	if (!ValidId(id) || !g_bLoaded[id])
		return 0
	return ClaimAllReady(id)
}

stock client_printcolor(id, const fmt[], any:...)
{
	new msg[192]
	vformat(msg, charsmax(msg), fmt, 3)
	replace_all(msg, charsmax(msg), "!g", "^4")
	replace_all(msg, charsmax(msg), "!t", "^3")
	replace_all(msg, charsmax(msg), "!n", "^1")
	replace_all(msg, charsmax(msg), "!Team", "^3")
	client_print_color(id, print_team_default, msg)
}
