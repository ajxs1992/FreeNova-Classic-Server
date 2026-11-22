/*
	Advanced Bans
	
	Version 0.8.1
	
	by Exolent
	
	
	
	Plugin Thread:
	
	- http://forums.alliedmods.net/showthread.php?t=80858
	
	
	
	Description:
	
	- This plugin revamps the current amx_ban, amx_banip, amx_banid, amx_unban admin commands.
	
	- It uses Real Time on the server
	  (Eg. Banned for 10 minutes, you will be unbanned 10 minutes later, regardless of map changing).
	
	- It includes a list of who is banned.
	
	- It does not use the banned.cfg or listip.cfg. It uses its own file where bans are stored.
	
	- It saves what admin banned the player (name), the admin's steamid, the reason, the ban time, 
	  the banned player's name, the banned player's steamid (or IP), and the estimated time of unban.
	
	- It will load your currently banned players from the banned.cfg and listip.cfg files.
	  (Only if the #define below is uncommented)
	
	- If you use the menu to ban players, you will have to type a reason after you choose a player.
	
	- If you use the vote system to ban players, you will have to type a reason after you execute the amx_voteban command.
	
	- You can limit the ban time for admins based on their admin flags.
	
	- You can monitor all ban history (admins banning, unbanning, and when ban times are up) in
	  the addons/amxmodx/logs/BAN_HISTORY_MMDDYYYY.log (MM = month, DD = day, YYYY = year)
	
	- If you wish to have only 1 file for ban history, uncomment the line at the top of the .sma file and recompile.
	
	- Supports SQL for banning.
	
	
	
	Commands:
	
	- amx_ban <nick, #userid, authid> <time in minutes> <reason>
	
	- amx_banip <nick, #userid, authid> <time in minutes> <reason>
	
	- amx_addban <name> <authid or ip> <time in minutes> <reason>
	
	- amx_unban <authid or ip>
	
	- amx_banlist
	  - Shows a list of who is banned
	
	- amx_addbanlimit <flags> <time in minutes>
	  - Adds a max ban time to the list
	  - Note: Use this command in the amxx.cfg
	
	
	
	Cvars:
	
	- ab_website <website>
	  - This is the website displayed to the banned player if you have an unban request section on your website.
	  - Leave blank to not show a website.
	  - Default: blank
	
	- ab_immunity <0|1|2>
	  - 0 - Any admin can ban an immunity admin (flag 'a').
	  - 1 - Immunity admins (flag 'a') cannot be banned.
	  - 2 - Immunity admins (flag 'a') can only be banned by other immunity admins (flag 'a').
	  - Default: 1
	
	- ab_bandelay <seconds>
	  - Delay of banned players being disconnected.
	  - Default: 1
	
	- ab_unbancheck <seconds>
	  - Interval of checking if a player is unbanned.
	  - Default: 5
	
	
	
	Requirements:
	
	- AMX Mod X version 1.8.0 or higher
	
	
	
	Changelog:

	- Version 0.1 (with updates included)
	  - Initial Release
	  - Changed to dynamic arrays to hold ban information
	  - Added option #2 for ab_immunity
	  - Added support for banning by IP
	  - Added compatability for banned.cfg and listip.cfg
	  - Added menu support (plmenu.amxx)
	  - Added ML support

	- Version 0.2
	  - Added simple max ban time feature

	- Version 0.3
	  - Added more cvars for max ban times
	  - Added cvar for delay of player to disconenct after being banned
	  - Added cvar for interval of checking for unban time of banned players
	  - Added more translations

	- Version 0.4
	  - Fixed the possible infinite loop, causing servers to crash
	  - Added ban history
	  - Removed max ban time cvars
	  - Added max ban times per admin flags
	  - Added more translations

	- Version 0.5
	  - Fixed information not being printed into console
	  - Fixed "amx_addban" using the admin's name as the SteamID when saving the ban
	  - Added option for ban history to be one file
	  - Added translations

	- Version 0.5b
	  - Fixed players not being unbanned
	  - Added translations
	
	- Version 0.6
	  - Added small optimization for unban checking
	  - Changed "UnBan Time" in the logs and chat messages to "Ban Length"
	  - Fixed small code error where unban time was generated was used when length was 0
	  - Changed IsValidIP() method to use regex (Thanks to arkshine)
	  - Added plugin information inside the .sma file
	  - Added a #define option to use maximum bans for compatability for AMXX < 1.8.0
	  - Changed admin messages in chat to work with amx_show_activity cvar
	  - Added translations
	
	- Version 0.6b
	  - Fixed a small bug
	
	- Version 0.6c
	  - Fixed amx_banlist for server consoles
	  - Changed IsValidAuthid() method to use regex
	
	- Version 0.6d
	  - Fixed ban limit for permanent bans
	
	- Version 0.7
	  - Changed the "unlimited bans" version to be faster (Thanks to joaquimandrade)
	  - Added check when adding bans if the player is already banned.
	
	- Version 0.8
	  - Added SQL support.
	
	- Version 0.8.1
	  - Added unban logging for non-SQL version
	
	
	
	Notes:
	
	- If you plan to use this plugin, go to the plugin's thread.
	
	- The plugin's thread has more information about the plugin, along with the multilingual file.
	
	- It also has a modified plmenu.amxx plugin that adds the ban reason to the menu.
	
	- And it has a modified adminvote.amxx plugin that adds the ban reason to amx_voteban.
*/



#include <amxmodx>
#include <amxmisc>
#include <engine>
/* #include <regex> removed 2026-10-03: no regex usage left (pure-Pawn validators) */

#define PLUGIN_NAME	"Advanced Bans"
#define PLUGIN_VERSION	"0.8.1"
#define PLUGIN_AUTHOR	"Exolent"

#pragma semicolon 1



// ===============================================
// CUSTOMIZATION STARTS HERE
// ===============================================


// uncomment the line below if you want this plugin to
// load old bans from the banned.cfg and listip.cfg files
//#define KEEP_DEFAULT_BANS


// uncomment the line below if you want the history to be in one file
//#define HISTORY_ONE_FILE


// if you must have a maximum amount of bans to be compatible with AMXX versions before 1.8.0
// change this number to your maximum amount
// if you would rather have unlimited (requires AMXX 1.8.0 or higher) then set it to 0
#define MAX_BANS 0


// if you want to use SQL for your server, then uncomment the line below
//#define USING_SQL


// ===============================================
// CUSTOMIZATION ENDS HERE
// ===============================================



#if defined USING_SQL
#include <sqlx>

#define TABLE_NAME		"advanced_bans"
#define KEY_NAME		"name"
#define KEY_STEAMID		"steamid"
#define KEY_BANLENGTH		"banlength"
#define KEY_UNBANTIME		"unbantime"
#define KEY_REASON		"reason"
#define KEY_ADMIN_NAME		"admin_name"
#define KEY_ADMIN_STEAMID	"admin_steamid"

#define RELOAD_BANS_INTERVAL	60.0
#endif

/* regex pattern defines removed 2026-10-03 - validators are pure Pawn now */
#define TASK_AUTH_RECHECK 800

/* g_IP_pattern / g_regex_return removed 2026-10-03 */

/*bool:IsValidIP(const ip[])
{
	return regex_match_c(ip, g_IP_pattern, g_regex_return) > 0;
}*/

#define IsValidIP(%1) AB_IsValidIP(%1)

/* 2026-10-03: IP validation moved to pure Pawn as well - the regex MODULE
   (regex_amxx.dll) was missing on a target server and blocked the whole
   plugin from loading. advanced_bans now has zero module dependencies. */
stock bool:AB_IsValidIP(const ip[])
{
	new parts = 0, i = 0;
	while (ip[i]) {
		new val = 0, digits = 0;
		while (ip[i] >= '0' && ip[i] <= '9') {
			val = val * 10 + (ip[i] - '0');
			digits++;
			if (digits > 3 || val > 255) return false;
			i++;
		}
		if (!digits) return false;
		parts++;
		if (parts > 4) return false;
		if (ip[i] == '.') {
			i++;
			if (!ip[i]) return false;   /* no trailing dot */
		} else if (ip[i]) {
			return false;
		}
	}
	return parts == 4;
}

/*bool:IsValidAuthid(const authid[])
{
	return regex_match_c(authid, g_SteamID_pattern, g_regex_return) > 0;
}*/

/* 2026-10-02: regex path replaced — live server rejected EVERY SteamID through
   regex_match_c(g_SteamID_pattern) while the IP twin worked, breaking
   amx_addban/amx_ban validation (and pg_sync's history pull applies).
   Same contract as ^^(STEAM|VALVE)_[0-9]:[01]:\d+$, pure Pawn. */
stock bool:AB_IsValidAuthid(const authid[])
{
	new i = 0;
	if (!strncmp(authid, "STEAM_", 6, true)) i = 6;
	else if (!strncmp(authid, "VALVE_", 6, true)) i = 6;
	else return false;
	if (!isdigit(authid[i])) return false;   /* [0-9] universe */
	i++;
	if (authid[i++] != ':') return false;
	if (authid[i] != '0' && authid[i] != '1') return false;   /* [01] */
	i++;
	if (authid[i++] != ':') return false;
	if (!isdigit(authid[i])) return false;   /* \d+ */
	while (authid[i]) {
		if (!isdigit(authid[i])) return false;
		i++;
	}
	return true;
}

#define IsValidAuthid(%1) AB_IsValidAuthid(%1)

bool:IsPendingOrLanAuth(const authid[])
{
	return equal(authid, "STEAM_ID_PENDING")
		|| equal(authid, "STEAM_ID_LAN")
		|| equali(authid, "VALVE_ID_LAN")
		|| equali(authid, "VALVE_ID_PENDING");
}

SanitizeEcho(str[], len)
{
	replace_all(str, len, "^"", "");
	replace_all(str, len, ";", "");
}


enum // for name displaying
{
	ACTIVITY_NONE, // nothing is shown
	ACTIVITY_HIDE, // admin name is hidden
	ACTIVITY_SHOW  // admin name is shown
};
new const g_admin_activity[] =
{
	ACTIVITY_NONE, // amx_show_activity 0 = show nothing to everyone
	ACTIVITY_HIDE, // amx_show_activity 1 = hide admin name from everyone
	ACTIVITY_SHOW, // amx_show_activity 2 = show admin name to everyone
	ACTIVITY_SHOW, // amx_show_activity 3 = show name to admins but hide it from normal users
	ACTIVITY_SHOW, // amx_show_activity 4 = show name to admins but show nothing to normal users
	ACTIVITY_HIDE  // amx_show_activity 5 = hide name from admins but show nothing to normal users
};
new const g_normal_activity[] =
{
	ACTIVITY_NONE, // amx_show_activity 0 = show nothing to everyone
	ACTIVITY_HIDE, // amx_show_activity 1 = hide admin name from everyone
	ACTIVITY_SHOW, // amx_show_activity 2 = show admin name to everyone
	ACTIVITY_HIDE, // amx_show_activity 3 = show name to admins but hide it from normal users
	ACTIVITY_NONE, // amx_show_activity 4 = show name to admins but show nothing to normal users
	ACTIVITY_NONE  // amx_show_activity 5 = hide name from admins but show nothing to normal users
};


#if MAX_BANS <= 0
enum _:BannedData
{
	bd_name[32],
	bd_steamid[35],
	bd_banlength,
	bd_unbantime[32],
	bd_reason[128],
	bd_admin_name[64],
	bd_admin_steamid[35]
};

new Trie:g_trie;
new Array:g_array;
#else
new g_names[MAX_BANS][32];
new g_steamids[MAX_BANS][35];
new g_banlengths[MAX_BANS];
new g_unbantimes[MAX_BANS][32];
new g_reasons[MAX_BANS][128];
new g_admin_names[MAX_BANS][64];
new g_admin_steamids[MAX_BANS][35];
#endif
new g_total_bans;

#if !defined USING_SQL
new g_ban_file[64];
#else
new Handle:g_sql_tuple;
new bool:g_loading_bans = true;
#endif

new ab_website;
new ab_immunity;
new ab_bandelay;
new ab_unbancheck;

new amx_show_activity;

#if MAX_BANS <= 0
new Array:g_maxban_times;
new Array:g_maxban_flags;
#else
#define MAX_BANLIMITS	30
new g_maxban_times[MAX_BANLIMITS];
new g_maxban_flags[MAX_BANLIMITS];
#endif
new g_total_maxban_times;

new g_unban_entity;

new g_max_clients;

new g_msgid_SayText;
new g_fwdCBanPre;
new g_fwdCBanPost;
new g_fwdCBanAdd;
new g_fwdCBanOff;
new g_fwdBanned;

public plugin_natives()
{
	register_native("CBan_BanPlayer", "_CBan_BanPlayer");
	register_native("CBan_UnbanPlayer", "_CBan_UnbanPlayer");
	register_native("CBan_OffBanPlayer", "_CBan_OffBanPlayer");
	register_native("CBan_AddBanPlayer", "_CBan_AddBanPlayer");
}

public plugin_init()
{
	register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);
	register_cvar("advanced_bans", PLUGIN_VERSION, FCVAR_SPONLY);
	
	register_dictionary("advanced_bans.txt");
	
	g_fwdBanned = CreateMultiForward("advanced_bans_player_banned", ET_IGNORE, FP_CELL, FP_CELL, FP_CELL, FP_STRING);
	g_fwdCBanPre = CreateMultiForward("CBan_OnPlayerBannedPre", ET_STOP, FP_CELL, FP_CELL, FP_VAL_BYREF, FP_STRING);
	g_fwdCBanPost = CreateMultiForward("CBan_OnPlayerBannedPost", ET_IGNORE, FP_CELL, FP_CELL, FP_CELL, FP_STRING);
	g_fwdCBanAdd = CreateMultiForward("CBan_OnAddBan", ET_STOP, FP_STRING, FP_CELL, FP_VAL_BYREF, FP_STRING);
	g_fwdCBanOff = CreateMultiForward("CBan_OnOffBan", ET_STOP, FP_STRING, FP_CELL, FP_VAL_BYREF, FP_STRING);
	
	register_concmd("amx_ban", "CmdBan", ADMIN_BAN, "<nick, #userid, authid> <time in minutes> <reason>");
	register_concmd("amx_banip", "CmdBanIp", ADMIN_BAN, "<nick, #userid, authid> <time in minutes> <reason>");
	register_concmd("amx_addban", "CmdAddBan", ADMIN_BAN, "<name> <authid or ip> <time in minutes> <reason>");
	register_concmd("amx_unban", "CmdUnban", ADMIN_BAN, "<authid or ip>");
	register_concmd("amx_banlist", "CmdBanList", ADMIN_BAN, "[start] -- shows everyone who is banned");
	register_srvcmd("amx_addbanlimit", "CmdAddBanLimit", -1, "<flag> <time in minutes>");
	
	ab_website = register_cvar("ab_website", "");
	ab_immunity = register_cvar("ab_immunity", "1");
	ab_bandelay = register_cvar("ab_bandelay", "1.0");
	ab_unbancheck = register_cvar("ab_unbancheck", "5.0");
	
	amx_show_activity = register_cvar("amx_show_activity", "2");
	
	#if MAX_BANS <= 0
	g_trie = TrieCreate();
	g_array = ArrayCreate(BannedData);
	#endif
	
	#if !defined MAX_BANLIMITS
	g_maxban_times = ArrayCreate(1);
	g_maxban_flags = ArrayCreate(1);
	#endif
	
	#if !defined USING_SQL
	get_datadir(g_ban_file, sizeof(g_ban_file) - 1);
	add(g_ban_file, sizeof(g_ban_file) - 1, "/advanced_bans.txt");
	
	LoadBans();
	#else
	g_sql_tuple = SQL_MakeStdTuple();
	PrepareTable();
	#endif
	
	/* regex compile block removed 2026-10-03: both validators are pure Pawn */
	
	g_max_clients = get_maxplayers();
	
	g_msgid_SayText = get_user_msgid("SayText");
}

#if defined USING_SQL
PrepareTable()
{
	new query[512];
	formatex(query, sizeof(query) - 1,\
		"CREATE TABLE IF NOT EXISTS `%s` (`%s` varchar(32) NOT NULL, `%s` varchar(35) NOT NULL, `%s` int(10) NOT NULL, `%s` varchar(32) NOT NULL, `%s` varchar(128) NOT NULL, `%s` varchar(64) NOT NULL, `%s` varchar(35) NOT NULL);",\
		TABLE_NAME, KEY_NAME, KEY_STEAMID, KEY_BANLENGTH, KEY_UNBANTIME, KEY_REASON, KEY_ADMIN_NAME, KEY_ADMIN_STEAMID
		);
	
	SQL_ThreadQuery(g_sql_tuple, "QueryCreateTable", query);
}

public QueryCreateTable(failstate, Handle:query, error[], errcode, data[], datasize, Float:queuetime)
{
	if( failstate == TQUERY_CONNECT_FAILED )
	{
		set_fail_state("Could not connect to database.");
	}
	else if( failstate == TQUERY_QUERY_FAILED )
	{
		set_fail_state("Query failed.");
	}
	else if( errcode )
	{
		log_amx("Error on query: %s", error);
	}
	else
	{
		LoadBans();
	}
}
#endif

public plugin_cfg()
{
	CreateUnbanEntity();
}

public CreateUnbanEntity()
{
	static failtimes;
	
	g_unban_entity = create_entity("info_target");
	
	if( !is_valid_ent(g_unban_entity) )
	{
		++failtimes;
		
		log_amx("[ERROR] Failed to create unban entity (%i/10)", failtimes);
		
		if( failtimes < 10 )
		{
			set_task(1.0, "CreateUnbanEntity");
		}
		else
		{
			log_amx("[ERROR] Could not create unban entity!");
		}
		
		return;
	}
	
	entity_set_string(g_unban_entity, EV_SZ_classname, "unban_entity");
	entity_set_float(g_unban_entity, EV_FL_nextthink, get_gametime() + 1.0);
	
	register_think("unban_entity", "FwdThink");
}

public client_authorized(client)
{
	CheckPlayerBan(client, true);
}

public client_putinserver(client)
{
	CheckPlayerBan(client, true);
}

public client_disconnected(client)
{
	if( task_exists(client) )
		remove_task(client);
	if( task_exists(client + TASK_AUTH_RECHECK) )
		remove_task(client + TASK_AUTH_RECHECK);
}

public TaskAuthRecheck(taskid)
{
	new client = taskid - TASK_AUTH_RECHECK;
	CheckPlayerBan(client, false);
}

CheckPlayerBan(client, bool:schedule_recheck)
{
	if( !is_user_connected(client) && !is_user_connecting(client) )
		return;
	
	if( task_exists(client) )
		return;
	
	static authid[35];
	get_user_authid(client, authid, sizeof(authid) - 1);
	
	static ip[35];
	get_user_ip(client, ip, sizeof(ip) - 1, 1);
	
	#if MAX_BANS > 0
	static banned_authid[35], bool:is_ip;
	for( new i = 0; i < g_total_bans; i++ )
	{
		copy(banned_authid, sizeof(banned_authid) - 1, g_steamids[i]);
		
		is_ip = bool:(containi(banned_authid, ".") != -1);
		
		if( is_ip && equal(ip, banned_authid) || !is_ip && equal(authid, banned_authid) )
		{
			static name[32], reason[128], unbantime[32], admin_name[32], admin_steamid[64];
			copy(name, sizeof(name) - 1, g_names[i]);
			copy(reason, sizeof(reason) - 1, g_reasons[i]);
			new banlength = g_banlengths[i];
			copy(unbantime, sizeof(unbantime) - 1, g_unbantimes[i]);
			copy(admin_name, sizeof(admin_name) - 1, g_admin_names[i]);
			copy(admin_steamid, sizeof(admin_steamid) - 1, g_admin_steamids[i]);
			
			PrintBanInformation(client, name, banned_authid, reason, banlength, unbantime, admin_name, admin_steamid, true, true);
			
			set_task(get_pcvar_float(ab_bandelay), "TaskDisconnectPlayer", client);
			return;
		}
	}
	#else
	static array_pos;
	
	if( TrieGetCell(g_trie, authid, array_pos) || TrieGetCell(g_trie, ip, array_pos) )
	{
		static data[BannedData];
		ArrayGetArray(g_array, array_pos, data);
		
		PrintBanInformation(client, data[bd_name], data[bd_steamid], data[bd_reason], data[bd_banlength], data[bd_unbantime], data[bd_admin_name], data[bd_admin_steamid], true, true);
		
		set_task(get_pcvar_float(ab_bandelay), "TaskDisconnectPlayer", client);
		return;
	}
	#endif
	
	if( schedule_recheck && IsPendingOrLanAuth(authid) && !task_exists(client + TASK_AUTH_RECHECK) )
		set_task(2.0, "TaskAuthRecheck", client + TASK_AUTH_RECHECK);
}

public CmdBan(client, level, cid)
{
	if( !cmd_access(client, level, cid, 4) ) return PLUGIN_HANDLED;
	
	static arg[128];
	read_argv(1, arg, sizeof(arg) - 1);
	
	new target = cmd_target(client, arg, GetTargetFlags(client));
	if( !target ) return PLUGIN_HANDLED;
	
	static target_authid[35];
	get_user_authid(target, target_authid, sizeof(target_authid) - 1);
	
	if( IsPendingOrLanAuth(target_authid) )
	{
		get_user_ip(target, target_authid, sizeof(target_authid) - 1, 1);
	}
	else if( !IsValidAuthid(target_authid) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_NOT_AUTHORIZED");
		return PLUGIN_HANDLED;
	}
	
	#if MAX_BANS <= 0
	if( TrieKeyExists(g_trie, target_authid) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_ALREADY_BANNED_STEAMID");
		return PLUGIN_HANDLED;
	}
	#else
	for( new i = 0; i < g_total_bans; i++ )
	{
		if( !strcmp(target_authid, g_steamids[i], 1) )
		{
			console_print(client, "[AdvancedBans] %L", client, "AB_ALREADY_BANNED_STEAMID");
			return PLUGIN_HANDLED;
		}
	}
	#endif
	
	read_argv(2, arg, sizeof(arg) - 1);
	
	new length = str_to_num(arg);
	new maxlength = GetMaxBanTime(client);
	
	if( maxlength && (!length || length > maxlength) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_MAX_BAN_TIME", maxlength);
		return PLUGIN_HANDLED;
	}
	
	static unban_time[64];
	if( length == 0 )
	{
		formatex(unban_time, sizeof(unban_time) - 1, "%L", client, "AB_PERMANENT_BAN");
	}
	else
	{
		GenerateUnbanTime(length, unban_time, sizeof(unban_time) - 1);
	}
	
	read_argv(3, arg, sizeof(arg) - 1);
	
	static admin_name[64], target_name[32];
	get_user_name(client, admin_name, sizeof(admin_name) - 1);
	get_user_name(target, target_name, sizeof(target_name) - 1);
	
	static admin_authid[35];
	get_user_authid(client, admin_authid, sizeof(admin_authid) - 1);
	
	if( !FireCBanPre(target, client, length, arg) )
		return PLUGIN_HANDLED;
	
	AddBan(target_name, target_authid, arg, length, unban_time, admin_name, admin_authid);
	FireCBanPost(target, client, length, arg);
	FireBannedForward(target, client, length, arg);
	
	PrintBanInformation(target, target_name, target_authid, arg, length, unban_time, admin_name, admin_authid, true, true);
	PrintBanInformation(client, target_name, target_authid, arg, length, unban_time, admin_name, admin_authid, false, false);
	
	set_task(get_pcvar_float(ab_bandelay), "TaskDisconnectPlayer", target);
	
	GetBanTime(length, unban_time, sizeof(unban_time) - 1);
	
	PrintActivity(admin_name, "^x04[AdvancedBans] $name^x01 :^x03  banned %s. Reason: %s. Ban Length: %s", target_name, arg, unban_time);
	
	Log("%s <%s> banned %s <%s> || Reason: ^"%s^" || Ban Length: %s", admin_name, admin_authid, target_name, target_authid, arg, unban_time);
	
	return PLUGIN_HANDLED;
}

public CmdBanIp(client, level, cid)
{
	if( !cmd_access(client, level, cid, 4) ) return PLUGIN_HANDLED;
	
	static arg[128];
	read_argv(1, arg, sizeof(arg) - 1);
	
	new target = cmd_target(client, arg, GetTargetFlags(client));
	if( !target ) return PLUGIN_HANDLED;
	
	static target_ip[35];
	get_user_ip(target, target_ip, sizeof(target_ip) - 1, 1);
	
	#if MAX_BANS <= 0
	if( TrieKeyExists(g_trie, target_ip) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_ALREADY_BANNED_IP");
		return PLUGIN_HANDLED;
	}
	#else
	for( new i = 0; i < g_total_bans; i++ )
	{
		if( !strcmp(target_ip, g_steamids[i], 1) )
		{
			console_print(client, "[AdvancedBans] %L", client, "AB_ALREADY_BANNED_IP");
			return PLUGIN_HANDLED;
		}
	}
	#endif
	
	read_argv(2, arg, sizeof(arg) - 1);
	
	new length = str_to_num(arg);
	new maxlength = GetMaxBanTime(client);
	
	if( maxlength && (!length || length > maxlength) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_MAX_BAN_TIME", maxlength);
		return PLUGIN_HANDLED;
	}
	
	static unban_time[32];
	
	if( length == 0 )
	{
		formatex(unban_time, sizeof(unban_time) - 1, "%L", client, "AB_PERMANENT_BAN");
	}
	else
	{
		GenerateUnbanTime(length, unban_time, sizeof(unban_time) - 1);
	}
	
	read_argv(3, arg, sizeof(arg) - 1);
	
	static admin_name[64], target_name[32];
	get_user_name(client, admin_name, sizeof(admin_name) - 1);
	get_user_name(target, target_name, sizeof(target_name) - 1);
	
	static admin_authid[35];
	get_user_authid(client, admin_authid, sizeof(admin_authid) - 1);
	
	if( !FireCBanPre(target, client, length, arg) )
		return PLUGIN_HANDLED;
	
	AddBan(target_name, target_ip, arg, length, unban_time, admin_name, admin_authid);
	FireCBanPost(target, client, length, arg);
	FireBannedForward(target, client, length, arg);
	
	PrintBanInformation(target, target_name, target_ip, arg, length, unban_time, admin_name, admin_authid, true, true);
	PrintBanInformation(client, target_name, target_ip, arg, length, unban_time, admin_name, admin_authid, false, false);
	
	set_task(get_pcvar_float(ab_bandelay), "TaskDisconnectPlayer", target);
	
	GetBanTime(length, unban_time, sizeof(unban_time) - 1);
	
	PrintActivity(admin_name, "^x04[AdvancedBans] $name^x01 :^x03  banned %s. Reason: %s. Ban Length: %s", target_name, arg, unban_time);
	
	Log("%s <%s> banned %s <%s> || Reason: ^"%s^" || Ban Length: %s", admin_name, admin_authid, target_name, target_ip, arg, unban_time);
	
	return PLUGIN_HANDLED;
}

public CmdAddBan(client, level, cid)
{
	if( !cmd_access(client, level, cid, 5) ) return PLUGIN_HANDLED;
	
	static target_name[32], target_authid[35], bantime[10], reason[128];
	read_argv(1, target_name, sizeof(target_name) - 1);
	read_argv(2, target_authid, sizeof(target_authid) - 1);
	read_argv(3, bantime, sizeof(bantime) - 1);
	read_argv(4, reason, sizeof(reason) - 1);
	
	new bool:is_ip = bool:(containi(target_authid, ".") != -1);
	
	if( !is_ip && !IsValidAuthid(target_authid) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_INVALID_STEAMID");
		console_print(client, "[AdvancedBans] %L", client, "AB_VALID_STEAMID_FORMAT");
		
		return PLUGIN_HANDLED;
	}
	else if( is_ip )
	{
		new pos = contain(target_authid, ":");
		if( pos > 0 )
		{
			target_authid[pos] = 0;
		}
		
		if( !IsValidIP(target_authid) )
		{
			console_print(client, "[AdvancedBans] %L", client, "AB_INVALID_IP");
			
			return PLUGIN_HANDLED;
		}
	}
	
	#if MAX_BANS <= 0
	if( TrieKeyExists(g_trie, target_authid) )
	{
		console_print(client, "[AdvancedBans] %L", client, is_ip ? "AB_ALREADY_BANNED_IP" : "AB_ALREADY_BANNED_STEAMID");
		return PLUGIN_HANDLED;
	}
	#else
	for( new i = 0; i < g_total_bans; i++ )
	{
		if( !strcmp(target_authid, g_steamids[i], 1) )
		{
			console_print(client, "[AdvancedBans] %L", client, is_ip ? "AB_ALREADY_BANNED_IP" : "AB_ALREADY_BANNED_STEAMID");
			return PLUGIN_HANDLED;
		}
	}
	#endif
	
	new length = str_to_num(bantime);
	new maxlength = GetMaxBanTime(client);
	
	if( maxlength && (!length || length > maxlength) )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_MAX_BAN_TIME", maxlength);
		return PLUGIN_HANDLED;
	}
	
	if( is_user_connected(find_player(is_ip ? "d" : "c", target_authid)) )
	{
		client_cmd(client, "amx_ban ^"%s^" %i ^"%s^"", target_authid, length, reason);
		return PLUGIN_HANDLED;
	}
	
	static unban_time[32];
	if( length == 0 )
	{
		formatex(unban_time, sizeof(unban_time) - 1, "%L", client, "AB_PERMANENT_BAN");
	}
	else
	{
		GenerateUnbanTime(length, unban_time, sizeof(unban_time) - 1);
	}
	
	static admin_name[64], admin_authid[35];
	get_user_name(client, admin_name, sizeof(admin_name) - 1);
	get_user_authid(client, admin_authid, sizeof(admin_authid) - 1);
	
	if( !FireCBanAdd(target_authid, client, length, reason) )
		return PLUGIN_HANDLED;
	
	AddBan(target_name, target_authid, reason, length, unban_time, admin_name, admin_authid);
	
	PrintBanInformation(client, target_name, target_authid, reason, length, unban_time, "", "", false, false);
	
	GetBanTime(length, unban_time, sizeof(unban_time) - 1);
	
	PrintActivity(admin_name, "^x04[AdvancedBans] $name^x01 :^x03  banned %s %s. Reason: %s. Ban Length: %s", is_ip ? "IP" : "SteamID", target_authid, reason, unban_time);
	
	Log("%s <%s> banned %s <%s> || Reason: ^"%s^" || Ban Length: %s", admin_name, admin_authid, target_name, target_authid, reason, unban_time);
	
	return PLUGIN_HANDLED;
}

public CmdUnban(client, level, cid)
{
	if( !cmd_access(client, level, cid, 2) ) return PLUGIN_HANDLED;
	
	static arg[35];
	read_argv(1, arg, sizeof(arg) - 1);
	
	#if MAX_BANS > 0
	static banned_authid[35];
	for( new i = 0; i < g_total_bans; i++ )
	{
		copy(banned_authid, sizeof(banned_authid) - 1, g_steamids[i]);
		
		if( equal(arg, banned_authid) )
		{
			static admin_name[64];
			get_user_name(client, admin_name, sizeof(admin_name) - 1);
			
			static name[32], reason[128];
			copy(name, sizeof(name) - 1, g_names[i]);
			copy(reason, sizeof(reason) - 1, g_reasons[i]);
			
			PrintActivity(admin_name, "^x04[AdvancedBans] $name^x01 :^x03  unbanned %s^x01 [%s] [Ban Reason: %s]", name, arg, reason);
			
			static authid[35];
			get_user_authid(client, authid, sizeof(authid) - 1);
			
			Log("%s <%s> unbanned %s <%s> || Ban Reason: ^"%s^"", admin_name, authid, name, arg, reason);
			
			RemoveBan(i);
			
			return PLUGIN_HANDLED;
		}
	}
	#else
	if( TrieKeyExists(g_trie, arg) )
	{
		static array_pos;
		TrieGetCell(g_trie, arg, array_pos);
		
		static data[BannedData];
		ArrayGetArray(g_array, array_pos, data);
		
		static unban_name[32];
		get_user_name(client, unban_name, sizeof(unban_name) - 1);
		
		PrintActivity(unban_name, "^x04[AdvancedBans] $name^x01 :^x03  unbanned %s^x01 [%s] [Ban Reason: %s]", data[bd_name], data[bd_steamid], data[bd_reason]);
		
		static admin_name[64];
		get_user_name(client, admin_name, sizeof(admin_name) - 1);
		
		static authid[35];
		get_user_authid(client, authid, sizeof(authid) - 1);
		
		Log("%s <%s> unbanned %s <%s> || Ban Reason: ^"%s^"", admin_name, authid, data[bd_name], data[bd_steamid], data[bd_reason]);
		
		RemoveBan(array_pos, data[bd_steamid]);
		
		return PLUGIN_HANDLED;
	}
	#endif
	
	console_print(client, "[AdvancedBans] %L", client, "AB_NOT_IN_BAN_LIST", arg);
	
	return PLUGIN_HANDLED;
}

public CmdBanList(client, level, cid)
{
	if( !cmd_access(client, level, cid, 1) ) return PLUGIN_HANDLED;
	
	if( !g_total_bans )
	{
		console_print(client, "[AdvancedBans] %L", client, "AB_NO_BANS");
		return PLUGIN_HANDLED;
	}
	
	static start;
	
	if( read_argc() > 1 )
	{
		static arg[5];
		read_argv(1, arg, sizeof(arg) - 1);
		
		start = str_to_num(arg) - 1;
		if( start < 0 ) start = 0;
		if( start >= g_total_bans ) start = g_total_bans - 1;
	}
	else
	{
		start = 0;
	}
	
	new last = min(start + 10, g_total_bans);
	
	if( client == 0 )
	{
		server_cmd("echo ^"%L^"", client, "AB_BAN_LIST_NUM", start + 1, last);
	}
	else
	{
		client_cmd(client, "echo ^"%L^"", client, "AB_BAN_LIST_NUM", start + 1, last);
	}
	
	for( new i = start; i < last; i++ )
	{
		#if MAX_BANS <= 0
		static data[BannedData];
		ArrayGetArray(g_array, i, data);
		
		PrintBanInformation(client, data[bd_name], data[bd_steamid], data[bd_reason], data[bd_banlength], data[bd_unbantime], data[bd_admin_name], data[bd_admin_steamid], true, false);
		#else
		static name[32], steamid[35], reason[128], banlength, unbantime[32], admin_name[32], admin_steamid[35];
		
		copy(name, sizeof(name) - 1, g_names[i]);
		copy(steamid, sizeof(steamid) - 1, g_steamids[i]);
		copy(reason, sizeof(reason) - 1, g_reasons[i]);
		banlength = g_banlengths[i];
		copy(unbantime, sizeof(unbantime) - 1, g_unbantimes[i]);
		copy(admin_name, sizeof(admin_name) - 1, g_admin_names[i]);
		copy(admin_steamid, sizeof(admin_steamid) - 1, g_admin_steamids[i]);
		
		PrintBanInformation(client, name, steamid, reason, banlength, unbantime, admin_name, admin_steamid, true, false);
		#endif
	}
	
	if( ++last < g_total_bans )
	{
		if( client == 0 )
		{
			server_cmd("echo ^"%L^"", client, "AB_BAN_LIST_NEXT", last);
		}
		else
		{
			client_cmd(client, "echo ^"%L^"", client, "AB_BAN_LIST_NEXT", last);
		}
	}
	
	return PLUGIN_HANDLED;
}

public CmdAddBanLimit()
{
	if( read_argc() != 3 )
	{
		log_amx("amx_addbanlimit was used with incorrect parameters!");
		log_amx("Usage: amx_addbanlimit <flags> <time in minutes>");
		return PLUGIN_HANDLED;
	}
	
	static arg[16];
	
	read_argv(1, arg, sizeof(arg) - 1);
	new flags = read_flags(arg);
	
	read_argv(2, arg, sizeof(arg) - 1);
	new minutes = str_to_num(arg);
	
	#if !defined MAX_BANLIMITS
	ArrayPushCell(g_maxban_flags, flags);
	ArrayPushCell(g_maxban_times, minutes);
	#else
	if( g_total_maxban_times >= MAX_BANLIMITS )
	{
		static notified;
		if( !notified )
		{
			log_amx("The amx_addbanlimit has reached its maximum!");
			notified = 1;
		}
		return PLUGIN_HANDLED;
	}
	
	g_maxban_flags[g_total_maxban_times] = flags;
	g_maxban_times[g_total_maxban_times] = minutes;
	#endif
	g_total_maxban_times++;
	
	return PLUGIN_HANDLED;
}

public FwdThink(entity)
{
	if( entity != g_unban_entity ) return;
	
	#if defined USING_SQL
	if( g_total_bans > 0 && !g_loading_bans )
	#else
	if( g_total_bans > 0 )
	#endif
	{
		static _hours[5], _minutes[5], _seconds[5], _month[5], _day[5], _year[7];
		format_time(_hours, sizeof(_hours) - 1, "%H");
		format_time(_minutes, sizeof(_minutes) - 1, "%M");
		format_time(_seconds, sizeof(_seconds) - 1, "%S");
		format_time(_month, sizeof(_month) - 1, "%m");
		format_time(_day, sizeof(_day) - 1, "%d");
		format_time(_year, sizeof(_year) - 1, "%Y");
		
		// c = current
		// u = unban
		
		new c_hours = str_to_num(_hours);
		new c_minutes = str_to_num(_minutes);
		new c_seconds = str_to_num(_seconds);
		new c_month = str_to_num(_month);
		new c_day = str_to_num(_day);
		new c_year = str_to_num(_year);
		
		static unban_time[32];
		static u_hours, u_minutes, u_seconds, u_month, u_day, u_year;
		
		for( new i = 0; i < g_total_bans; i++ )
		{
			#if MAX_BANS <= 0
			static data[BannedData];
			ArrayGetArray(g_array, i, data);
			
			if( data[bd_banlength] == 0 ) continue;
			#else
			if( g_banlengths[i] == 0 ) continue;
			#endif
			
			#if MAX_BANS <= 0
			copy(unban_time, sizeof(unban_time) - 1, data[bd_unbantime]);
			#else
			copy(unban_time, sizeof(unban_time) - 1, g_unbantimes[i]);
			#endif
			replace_all(unban_time, sizeof(unban_time) - 1, ":", " ");
			replace_all(unban_time, sizeof(unban_time) - 1, "/", " ");
			
			parse(unban_time,\
				_hours, sizeof(_hours) - 1,\
				_minutes, sizeof(_minutes) - 1,\
				_seconds, sizeof(_seconds) - 1,\
				_month, sizeof(_month) - 1,\
				_day, sizeof(_day) - 1,\
				_year, sizeof(_year) - 1
				);
			
			u_hours = str_to_num(_hours);
			u_minutes = str_to_num(_minutes);
			u_seconds = str_to_num(_seconds);
			u_month = str_to_num(_month);
			u_day = str_to_num(_day);
			u_year = str_to_num(_year);
			
			if( u_year < c_year
			|| u_year == c_year && u_month < c_month
			|| u_year == c_year && u_month == c_month && u_day < c_day
			|| u_year == c_year && u_month == c_month && u_day == c_day && u_hours < c_hours
			|| u_year == c_year && u_month == c_month && u_day == c_day && u_hours == c_hours && u_minutes < c_minutes
			|| u_year == c_year && u_month == c_month && u_day == c_day && u_hours == c_hours && u_minutes == c_minutes && u_seconds <= c_seconds )
			{
				#if MAX_BANS <= 0
				Log("Ban time is up for: %s [%s]", data[bd_name], data[bd_steamid]);
				
				Print("^x04[AdvancedBans]^x03 %s^x01[^x04%s^x01]^x03 ban time is up!^x01 [Ban Reason: %s]", data[bd_name], data[bd_steamid], data[bd_reason]);
				
				RemoveBan(i, data[bd_steamid]);
				#else
				Log("Ban time is up for: %s [%s]", g_names[i], g_steamids[i]);
				
				Print("^x04[AdvancedBans]^x03 %s^x01[^x04%s^x01]^x03 ban time is up!^x01 [Ban Reason: %s]", g_names[i], g_steamids[i], g_reasons[i]);
				
				RemoveBan(i);
				#endif
				
				i--; // current pos was replaced with another ban, so we need to check it again.
			}
		}
	}
	
	entity_set_float(g_unban_entity, EV_FL_nextthink, get_gametime() + get_pcvar_float(ab_unbancheck));
}

public TaskDisconnectPlayer(client)
{
	if( !is_user_connected(client) && !is_user_connecting(client) )
		return;
	
	new userid = get_user_userid(client);
	if( userid <= 0 )
		return;
	
	server_cmd("kick #%i ^"You are banned from this server. Check your console^"", userid);
}

AddBan(const target_name[], const target_steamid[], const reason[], const length, const unban_time[], const admin_name[], const admin_steamid[])
{
	#if MAX_BANS > 0
	if( g_total_bans == MAX_BANS )
	{
		log_amx("Ban list is full! (%i)", g_total_bans);
		return;
	}
	#endif
	
	#if defined USING_SQL
	static target_name2[64], target_steamid2[70], unban_time2[64], reason2[256], admin_name2[128], admin_steamid2[70];
	MakeStringSQLSafe(target_name, target_name2, sizeof(target_name2) - 1);
	MakeStringSQLSafe(target_steamid, target_steamid2, sizeof(target_steamid2) - 1);
	MakeStringSQLSafe(unban_time, unban_time2, sizeof(unban_time2) - 1);
	MakeStringSQLSafe(reason, reason2, sizeof(reason2) - 1);
	MakeStringSQLSafe(admin_name, admin_name2, sizeof(admin_name2) - 1);
	MakeStringSQLSafe(admin_steamid, admin_steamid2, sizeof(admin_steamid2) - 1);
	
	static query[1024];
	formatex(query, sizeof(query) - 1,\
		"INSERT INTO `%s` (`%s`, `%s`, `%s`, `%s`, `%s`, `%s`, `%s`) VALUES ('%s', '%s', '%i', '%s', '%s', '%s', '%s');",\
		TABLE_NAME, KEY_NAME, KEY_STEAMID, KEY_BANLENGTH, KEY_UNBANTIME, KEY_REASON, KEY_ADMIN_NAME, KEY_ADMIN_STEAMID,\
		target_name2, target_steamid2, length, unban_time2, reason2, admin_name2, admin_steamid2
		);
	
	SQL_ThreadQuery(g_sql_tuple, "QueryAddBan", query);
	#else
	new f = fopen(g_ban_file, "a+");
	
	fprintf(f, "^"%s^" ^"%s^" %i ^"%s^" ^"%s^" ^"%s^" ^"%s^"^n",\
		target_steamid,\
		target_name,\
		length,\
		unban_time,\
		reason,\
		admin_name,\
		admin_steamid
		);
	
	fclose(f);
	#endif
	
	#if MAX_BANS <= 0
	static data[BannedData];
	copy(data[bd_name], sizeof(data[bd_name]) - 1, target_name);
	copy(data[bd_steamid], sizeof(data[bd_steamid]) - 1, target_steamid);
	data[bd_banlength] = length;
	copy(data[bd_unbantime], sizeof(data[bd_unbantime]) - 1, unban_time);
	copy(data[bd_reason], sizeof(data[bd_reason]) - 1, reason);
	copy(data[bd_admin_name], sizeof(data[bd_admin_name]) - 1, admin_name);
	copy(data[bd_admin_steamid], sizeof(data[bd_admin_steamid]) - 1, admin_steamid);
	
	TrieSetCell(g_trie, target_steamid, g_total_bans);
	ArrayPushArray(g_array, data);
	#else
	copy(g_names[g_total_bans], sizeof(g_names[]) - 1, target_name);
	copy(g_steamids[g_total_bans], sizeof(g_steamids[]) - 1, target_steamid);
	g_banlengths[g_total_bans] = length;
	copy(g_unbantimes[g_total_bans], sizeof(g_unbantimes[]) - 1, unban_time);
	copy(g_reasons[g_total_bans], sizeof(g_reasons[]) - 1, reason);
	copy(g_admin_names[g_total_bans], sizeof(g_admin_names[]) - 1, admin_name);
	copy(g_admin_steamids[g_total_bans], sizeof(g_admin_steamids[]) - 1, admin_steamid);
	#endif
	
	g_total_bans++;
	
	#if MAX_BANS > 0
	if( g_total_bans == MAX_BANS )
	{
		log_amx("Ban list is full! (%i)", g_total_bans);
	}
	#endif
}

#if defined USING_SQL
public QueryAddBan(failstate, Handle:query, error[], errcode, data[], datasize, Float:queuetime)
{
	if( failstate == TQUERY_CONNECT_FAILED )
	{
		log_amx("[AdvancedBans] AddBan SQL connect failed: %s", error);
	}
	else if( failstate == TQUERY_QUERY_FAILED )
	{
		log_amx("[AdvancedBans] AddBan SQL query failed: %s", error);
	}
	else if( errcode )
	{
		log_amx("Error on query: %s", error);
	}
}

public QueryDeleteBan(failstate, Handle:query, error[], errcode, data[], datasize, Float:queuetime)
{
	if( failstate == TQUERY_CONNECT_FAILED )
	{
		log_amx("[AdvancedBans] DeleteBan SQL connect failed: %s", error);
	}
	else if( failstate == TQUERY_QUERY_FAILED )
	{
		log_amx("[AdvancedBans] DeleteBan SQL query failed: %s", error);
	}
	else if( errcode )
	{
		log_amx("Error on query: %s", error);
	}
}

public QueryLoadBans(failstate, Handle:query, error[], errcode, data[], datasize, Float:queuetime)
{
	if( failstate == TQUERY_CONNECT_FAILED )
	{
		log_amx("[AdvancedBans] LoadBans SQL connect failed: %s", error);
		g_loading_bans = false;
		set_task(RELOAD_BANS_INTERVAL, "LoadBans");
		return;
	}
	else if( failstate == TQUERY_QUERY_FAILED )
	{
		log_amx("[AdvancedBans] LoadBans SQL query failed: %s", error);
		g_loading_bans = false;
		set_task(RELOAD_BANS_INTERVAL, "LoadBans");
		return;
	}
	else if( errcode )
	{
		log_amx("Error on query: %s", error);
		g_loading_bans = false;
		set_task(RELOAD_BANS_INTERVAL, "LoadBans");
		return;
	}
	
	#if MAX_BANS <= 0
	new Trie:new_trie = TrieCreate();
	new Array:new_array = ArrayCreate(BannedData);
	new new_total;
	static data[BannedData];
	
	while( SQL_MoreResults(query) )
	{
		SQL_ReadResult(query, 0, data[bd_name], sizeof(data[bd_name]) - 1);
		SQL_ReadResult(query, 1, data[bd_steamid], sizeof(data[bd_steamid]) - 1);
		data[bd_banlength] = SQL_ReadResult(query, 2);
		SQL_ReadResult(query, 3, data[bd_unbantime], sizeof(data[bd_unbantime]) - 1);
		SQL_ReadResult(query, 4, data[bd_reason], sizeof(data[bd_reason]) - 1);
		SQL_ReadResult(query, 5, data[bd_admin_name], sizeof(data[bd_admin_name]) - 1);
		SQL_ReadResult(query, 6, data[bd_admin_steamid], sizeof(data[bd_admin_steamid]) - 1);
		
		ArrayPushArray(new_array, data);
		TrieSetCell(new_trie, data[bd_steamid], new_total);
		new_total++;
		
		SQL_NextRow(query);
	}
	
	for( new i = 0; i < g_total_bans; i++ )
	{
		ArrayGetArray(g_array, i, data);
		if( !TrieKeyExists(new_trie, data[bd_steamid]) )
		{
			TrieSetCell(new_trie, data[bd_steamid], new_total);
			ArrayPushArray(new_array, data);
			new_total++;
		}
	}
	
	new Trie:old_trie = g_trie;
	new Array:old_array = g_array;
	g_trie = new_trie;
	g_array = new_array;
	g_total_bans = new_total;
	TrieDestroy(old_trie);
	ArrayDestroy(old_array);
	g_loading_bans = false;
	#else
	new new_total;
	while( SQL_MoreResults(query) && new_total < MAX_BANS )
	{
		SQL_ReadResult(query, 0, g_names[new_total], sizeof(g_names[]) - 1);
		SQL_ReadResult(query, 1, g_steamids[new_total], sizeof(g_steamids[]) - 1);
		g_banlengths[new_total] = SQL_ReadResult(query, 2);
		SQL_ReadResult(query, 3, g_unbantimes[new_total], sizeof(g_unbantimes[]) - 1);
		SQL_ReadResult(query, 4, g_reasons[new_total], sizeof(g_reasons[]) - 1);
		SQL_ReadResult(query, 5, g_admin_names[new_total], sizeof(g_admin_names[]) - 1);
		SQL_ReadResult(query, 6, g_admin_steamids[new_total], sizeof(g_admin_steamids[]) - 1);
		
		new_total++;
		SQL_NextRow(query);
	}
	g_total_bans = new_total;
	g_loading_bans = false;
	#endif
	
	RescanConnectedPlayers();
	set_task(RELOAD_BANS_INTERVAL, "LoadBans");
}
#endif

#if MAX_BANS > 0
RemoveBan(remove)
{
	#if defined USING_SQL
	static steamid_esc[70], query[192];
	MakeStringSQLSafe(g_steamids[remove], steamid_esc, sizeof(steamid_esc) - 1);
	formatex(query, sizeof(query) - 1,\
		"DELETE FROM `%s` WHERE `%s` = '%s';",\
		TABLE_NAME, KEY_STEAMID, steamid_esc
		);
	
	SQL_ThreadQuery(g_sql_tuple, "QueryDeleteBan", query);
	#endif
	
	for( new i = remove; i < g_total_bans; i++ )
	{
		if( (i + 1) == g_total_bans )
		{
			copy(g_names[i], sizeof(g_names[]) - 1, "");
			copy(g_steamids[i], sizeof(g_steamids[]) - 1, "");
			g_banlengths[i] = 0;
			copy(g_unbantimes[i], sizeof(g_unbantimes[]) - 1, "");
			copy(g_reasons[i], sizeof(g_reasons[]) - 1, "");
			copy(g_admin_names[i], sizeof(g_admin_names[]) - 1, "");
			copy(g_admin_steamids[i], sizeof(g_admin_steamids[]) - 1, "");
		}
		else
		{
			copy(g_names[i], sizeof(g_names[]) - 1, g_names[i + 1]);
			copy(g_steamids[i], sizeof(g_steamids[]) - 1, g_steamids[i + 1]);
			g_banlengths[i] = g_banlengths[i + 1];
			copy(g_unbantimes[i], sizeof(g_unbantimes[]) - 1, g_unbantimes[i + 1]);
			copy(g_reasons[i], sizeof(g_reasons[]) - 1, g_reasons[i + 1]);
			copy(g_admin_names[i], sizeof(g_admin_names[]) - 1, g_admin_names[i + 1]);
			copy(g_admin_steamids[i], sizeof(g_admin_steamids[]) - 1, g_admin_steamids[i + 1]);
		}
	}
	
	g_total_bans--;
	
	#if !defined USING_SQL
	new f = fopen(g_ban_file, "wt");
	
	static name[32], steamid[35], banlength, unbantime[32], reason[128], admin_name[32], admin_steamid[35];
	for( new i = 0; i < g_total_bans; i++ )
	{
		copy(name, sizeof(name) - 1, g_names[i]);
		copy(steamid, sizeof(steamid) - 1, g_steamids[i]);
		banlength = g_banlengths[i];
		copy(unbantime, sizeof(unbantime) - 1, g_unbantimes[i]);
		copy(reason, sizeof(reason) - 1, g_reasons[i]);
		copy(admin_name, sizeof(admin_name) - 1, g_admin_names[i]);
		copy(admin_steamid, sizeof(admin_steamid) - 1, g_admin_steamids[i]);
		
		fprintf(f, "^"%s^" ^"%s^" %i ^"%s^" ^"%s^" ^"%s^" ^"%s^"^n",\
			steamid,\
			name,\
			banlength,\
			unbantime,\
			reason,\
			admin_name,\
			admin_steamid
			);
	}
	
	fclose(f);
	#endif
}
#else
RemoveBan(pos, const authid[])
{
	TrieDeleteKey(g_trie, authid);
	ArrayDeleteItem(g_array, pos);
	
	g_total_bans--;
	
	#if defined USING_SQL
	static steamid_esc[70], query[192];
	MakeStringSQLSafe(authid, steamid_esc, sizeof(steamid_esc) - 1);
	formatex(query, sizeof(query) - 1,\
		"DELETE FROM `%s` WHERE `%s` = '%s';",\
		TABLE_NAME, KEY_STEAMID, steamid_esc
		);
	
	SQL_ThreadQuery(g_sql_tuple, "QueryDeleteBan", query);
	
	new data[BannedData];
	for( new i = 0; i < g_total_bans; i++ )
	{
		ArrayGetArray(g_array, i, data);
		TrieSetCell(g_trie, data[bd_steamid], i);
	}
	#else
	new f = fopen(g_ban_file, "wt");
	
	new data[BannedData];
	for( new i = 0; i < g_total_bans; i++ )
	{
		ArrayGetArray(g_array, i, data);
		TrieSetCell(g_trie, data[bd_steamid], i);
		
		fprintf(f, "^"%s^" ^"%s^" %i ^"%s^" ^"%s^" ^"%s^" ^"%s^"^n",\
			data[bd_steamid],\
			data[bd_name],\
			data[bd_banlength],\
			data[bd_unbantime],\
			data[bd_reason],\
			data[bd_admin_name],\
			data[bd_admin_steamid]
			);
	}
	
	fclose(f);
	#endif
}
#endif

#if defined KEEP_DEFAULT_BANS
LoadOldBans(filename[])
{
	if( file_exists(filename) )
	{
		new f = fopen(filename, "rt");
		
		static data[96];
		static command[10], minutes[10], steamid[35], length, unban_time[32];
		
		while( !feof(f) )
		{
			fgets(f, data, sizeof(data) - 1);
			if( !data[0] ) continue;
			
			parse(data, command, sizeof(command) - 1, minutes, sizeof(minutes) - 1, steamid, sizeof(steamid) - 1);
			if( filename[0] == 'b' && !equali(command, "banid") || filename[0] == 'l' && !equali(command, "addip") ) continue;
			
			length = str_to_num(minutes);
			GenerateUnbanTime(length, unban_time, sizeof(unban_time) - 1);
			
			AddBan("", steamid, "", length, unban_time, "", "");
		}
		
		fclose(f);
		
		static filename2[32];
		
		// copy current
		copy(filename2, sizeof(filename2) - 1, filename);
		
		// cut off at the "."
		// banned.cfg = banned
		// listip.cfg = listip
		filename2[containi(filename2, ".")] = 0;
		
		// add 2.cfg
		// banned = banned2.cfg
		// listip = listip2.cfg
		add(filename2, sizeof(filename2) - 1, "2.cfg");
		
		// rename file so that it isnt loaded again
		while( !rename_file(filename, filename2, 1) ) { }
	}
}
#endif

public LoadBans()
{
	#if !defined USING_SQL
	if( g_total_bans )
	{
		#if MAX_BANS <= 0
		TrieClear(g_trie);
		ArrayClear(g_array);
		#endif
		
		g_total_bans = 0;
	}
	#endif
	
	#if defined USING_SQL
	static query[128];
	formatex(query, sizeof(query) - 1,\
		"SELECT * FROM `%s`;",\
		TABLE_NAME
		);
	
	SQL_ThreadQuery(g_sql_tuple, "QueryLoadBans", query);
	#else
	if( file_exists(g_ban_file) )
	{
		new f = fopen(g_ban_file, "rt");
		
		static filedata[512], length[10];
		
		#if MAX_BANS <= 0
		static data[BannedData];
		while( !feof(f) )
		#else
		while( !feof(f) && g_total_bans < MAX_BANS )
		#endif
		{
			fgets(f, filedata, sizeof(filedata) - 1);
			
			if( !filedata[0] ) continue;
			
			#if MAX_BANS <= 0
			parse(filedata,\
				data[bd_steamid], sizeof(data[bd_steamid]) - 1,\
				data[bd_name], sizeof(data[bd_name]) - 1,\
				length, sizeof(length) - 1,\
				data[bd_unbantime], sizeof(data[bd_unbantime]) - 1,\
				data[bd_reason], sizeof(data[bd_reason]) - 1,\
				data[bd_admin_name], sizeof(data[bd_admin_name]) - 1,\
				data[bd_admin_steamid], sizeof(data[bd_admin_steamid]) - 1
				);
			
			data[bd_banlength] = str_to_num(length);
			
			ArrayPushArray(g_array, data);
			TrieSetCell(g_trie, data[bd_steamid], g_total_bans);
			#else
			static steamid[35], name[32], unbantime[32], reason[128], admin_name[32], admin_steamid[35];
			
			parse(filedata,\
				steamid, sizeof(steamid) - 1,\
				name, sizeof(name) - 1,\
				length, sizeof(length) - 1,\
				unbantime, sizeof(unbantime) - 1,\
				reason, sizeof(reason) - 1,\
				admin_name, sizeof(admin_name) - 1,\
				admin_steamid, sizeof(admin_steamid) - 1
				);
			
			copy(g_names[g_total_bans], sizeof(g_names[]) - 1, name);
			copy(g_steamids[g_total_bans], sizeof(g_steamids[]) - 1, steamid);
			g_banlengths[g_total_bans] = str_to_num(length);
			copy(g_unbantimes[g_total_bans], sizeof(g_unbantimes[]) - 1, unbantime);
			copy(g_reasons[g_total_bans], sizeof(g_reasons[]) - 1, reason);
			copy(g_admin_names[g_total_bans], sizeof(g_admin_names[]) - 1, admin_name);
			copy(g_admin_steamids[g_total_bans], sizeof(g_admin_steamids[]) - 1, admin_steamid);
			#endif
			
			g_total_bans++;
		}
		
		fclose(f);
	}
	#endif
	
	// load these after, so when they are added to the file with AddBan(), they aren't loaded again from above.
	
	#if defined KEEP_DEFAULT_BANS
	LoadOldBans("banned.cfg");
	LoadOldBans("listip.cfg");
	#endif
	
	#if !defined USING_SQL
	RescanConnectedPlayers();
	#endif
}

#if defined USING_SQL
MakeStringSQLSafe(const input[], output[], len)
{
	SQL_QuoteString(Empty_Handle, output, len, input);
}
#endif

GetBanTime(const bantime, length[], len)
{
	new minutes = bantime;
	new hours = 0;
	new days = 0;
	
	while( minutes >= 60 )
	{
		minutes -= 60;
		hours++;
	}
	
	while( hours >= 24 )
	{
		hours -= 24;
		days++;
	}
	
	new bool:add_before;
	if( minutes )
	{
		formatex(length, len, "%i minute%s", minutes, minutes == 1 ? "" : "s");
		
		add_before = true;
	}
	if( hours )
	{
		if( add_before )
		{
			format(length, len, "%i hour%s, %s", hours, hours == 1 ? "" : "s", length);
		}
		else
		{
			formatex(length, len, "%i hour%s", hours, hours == 1 ? "" : "s");
			
			add_before = true;
		}
	}
	if( days )
	{
		if( add_before )
		{
			format(length, len, "%i day%s, %s", days, days == 1 ? "" : "s", length);
		}
		else
		{
			formatex(length, len, "%i day%s", days, days == 1 ? "" : "s");
			
			add_before = true;
		}
	}
	if( !add_before )
	{
		// minutes, hours, and days = 0
		// assume permanent ban
		copy(length, len, "Permanent Ban");
	}
}

GenerateUnbanTime(const bantime, unban_time[], len)
{
	static _hours[5], _minutes[5], _seconds[5], _month[5], _day[5], _year[7];
	format_time(_hours, sizeof(_hours) - 1, "%H");
	format_time(_minutes, sizeof(_minutes) - 1, "%M");
	format_time(_seconds, sizeof(_seconds) - 1, "%S");
	format_time(_month, sizeof(_month) - 1, "%m");
	format_time(_day, sizeof(_day) - 1, "%d");
	format_time(_year, sizeof(_year) - 1, "%Y");
	
	new hours = str_to_num(_hours);
	new minutes = str_to_num(_minutes);
	new seconds = str_to_num(_seconds);
	new month = str_to_num(_month);
	new day = str_to_num(_day);
	new year = str_to_num(_year);
	
	minutes += bantime;
	
	while( minutes >= 60 )
	{
		minutes -= 60;
		hours++;
	}
	
	while( hours >= 24 )
	{
		hours -= 24;
		day++;
	}
	
	new max_days = GetDaysInMonth(month, year);
	while( day > max_days )
	{
		day -= max_days;
		month++;
	}
	
	while( month > 12 )
	{
		month -= 12;
		year++;
	}
	
	formatex(unban_time, len, "%i:%02i:%02i %i/%i/%i", hours, minutes, seconds, month, day, year);
}

GetDaysInMonth(month, year=0)
{
	switch( month )
	{
		case 1:		return 31; // january
		case 2:		return ((year % 4) == 0) ? 29 : 28; // february
		case 3:		return 31; // march
		case 4:		return 30; // april
		case 5:		return 31; // may
		case 6:		return 30; // june
		case 7:		return 31; // july
		case 8:		return 31; // august
		case 9:		return 30; // september
		case 10:	return 31; // october
		case 11:	return 30; // november
		case 12:	return 31; // december
	}
	
	return 30;
}

GetTargetFlags(client)
{
	static const flags_no_immunity = (CMDTARGET_ALLOW_SELF|CMDTARGET_NO_BOTS);
	static const flags_immunity = (CMDTARGET_ALLOW_SELF|CMDTARGET_NO_BOTS|CMDTARGET_OBEY_IMMUNITY);
	
	switch( get_pcvar_num(ab_immunity) )
	{
		case 1: return flags_immunity;
		case 2: return access(client, ADMIN_IMMUNITY) ? flags_no_immunity : flags_immunity;
	}
	
	return flags_no_immunity;
}

GetMaxBanTime(client)
{
	if( !g_total_maxban_times ) return 0;
	
	new flags = get_user_flags(client);
	
	for( new i = 0; i < g_total_maxban_times; i++ )
	{
		#if !defined MAX_BANLIMITS
		if( flags & ArrayGetCell(g_maxban_flags, i) )
		{
			return ArrayGetCell(g_maxban_times, i);
		}
		#else
		if( flags & g_maxban_flags[i] )
		{
			return g_maxban_times[i];
		}
		#endif
	}
	
	return 0;
}

PrintBanInformation(client, const target_name[], const target_authid[], const reason[], const length, const unban_time[], const admin_name[], const admin_authid[], bool:show_admin, bool:show_website)
{
	static website[64], ban_length[64];
	if( client == 0 )
	{
		server_print("************************************************");
		server_print("%L", client, "AB_BAN_INFORMATION");
		server_print("%L: %s", client, "AB_NAME", target_name);
		server_print("%L: %s", client, IsValidAuthid(target_authid) ? "AB_STEAMID" : "AB_IP", target_authid);
		server_print("%L: %s", client, "AB_REASON", reason);
		if( length > 0 )
		{
			GetBanTime(length, ban_length, sizeof(ban_length) - 1);
			server_print("%L: %s", client, "AB_BAN_LENGTH", ban_length);
		}
		server_print("%L: %s", client, "AB_UNBAN_TIME", unban_time);
		if( show_admin )
		{
			server_print("%L: %s", client, "AB_ADMIN_NAME", admin_name);
			server_print("%L: %s", client, "AB_ADMIN_STEAMID", admin_authid);
		}
		if( show_website )
		{
			get_pcvar_string(ab_website, website, sizeof(website) - 1);
			if( website[0] )
			{
				server_print("");
				server_print("%L", client, "AB_WEBSITE");
				server_print("%s", website);
			}
		}
		server_print("************************************************");
	}
	else
	{
		static echo_name[32], echo_authid[35], echo_reason[128], echo_unban[32], echo_admin[64], echo_adminid[35];
		copy(echo_name, sizeof(echo_name) - 1, target_name);
		copy(echo_authid, sizeof(echo_authid) - 1, target_authid);
		copy(echo_reason, sizeof(echo_reason) - 1, reason);
		copy(echo_unban, sizeof(echo_unban) - 1, unban_time);
		copy(echo_admin, sizeof(echo_admin) - 1, admin_name);
		copy(echo_adminid, sizeof(echo_adminid) - 1, admin_authid);
		SanitizeEcho(echo_name, sizeof(echo_name) - 1);
		SanitizeEcho(echo_authid, sizeof(echo_authid) - 1);
		SanitizeEcho(echo_reason, sizeof(echo_reason) - 1);
		SanitizeEcho(echo_unban, sizeof(echo_unban) - 1);
		SanitizeEcho(echo_admin, sizeof(echo_admin) - 1);
		SanitizeEcho(echo_adminid, sizeof(echo_adminid) - 1);
		
		client_cmd(client, "echo ^"************************************************^"");
		client_cmd(client, "echo ^"%L^"", client, "AB_BAN_INFORMATION");
		client_cmd(client, "echo ^"%L: %s^"", client, "AB_NAME", echo_name);
		client_cmd(client, "echo ^"%L: %s^"", client, IsValidAuthid(target_authid) ? "AB_STEAMID" : "AB_IP", echo_authid);
		client_cmd(client, "echo ^"%L: %s^"", client, "AB_REASON", echo_reason);
		if( length > 0 )
		{
			GetBanTime(length, ban_length, sizeof(ban_length) - 1);
			client_cmd(client, "echo ^"%L: %s^"", client, "AB_BAN_LENGTH", ban_length);
		}
		client_cmd(client, "echo ^"%L: %s^"", client, "AB_UNBAN_TIME", echo_unban);
		if( show_admin )
		{
			client_cmd(client, "echo ^"%L: %s^"", client, "AB_ADMIN_NAME", echo_admin);
			client_cmd(client, "echo ^"%L: %s^"", client, "AB_ADMIN_STEAMID", echo_adminid);
		}
		if( show_website )
		{
			get_pcvar_string(ab_website, website, sizeof(website) - 1);
			if( website[0] )
			{
				SanitizeEcho(website, sizeof(website) - 1);
				client_cmd(client, "echo ^"^"");
				client_cmd(client, "echo ^"%L^"", client, "AB_WEBSITE");
				client_cmd(client, "echo ^"%s^"", website);
			}
		}
		client_cmd(client, "echo ^"************************************************^"");
	}
}

PrintActivity(const admin_name[], const message_fmt[], any:...)
{
	if( !get_playersnum() ) return;
	
	new activity = get_pcvar_num(amx_show_activity);
	if( !(0 <= activity <= 5) )
	{
		set_pcvar_num(amx_show_activity, (activity = 2));
	}
	
	static message[192], temp[192];
	vformat(message, sizeof(message) - 1, message_fmt, 3);
	
	for( new client = 1; client <= g_max_clients; client++ )
	{
		if( !is_user_connected(client) ) continue;
		
		switch( is_user_admin(client) ? g_admin_activity[activity] : g_normal_activity[activity] )
		{
			case ACTIVITY_NONE:
			{
				
			}
			case ACTIVITY_HIDE:
			{
				copy(temp, sizeof(temp) - 1, message);
				replace(temp, sizeof(temp) - 1, "$name", "ADMIN");
				
				message_begin(MSG_ONE_UNRELIABLE, g_msgid_SayText, _, client);
				write_byte(client);
				write_string(temp);
				message_end();
			}
			case ACTIVITY_SHOW:
			{
				copy(temp, sizeof(temp) - 1, message);
				replace(temp, sizeof(temp) - 1, "$name", admin_name);
				
				message_begin(MSG_ONE_UNRELIABLE, g_msgid_SayText, _, client);
				write_byte(client);
				write_string(temp);
				message_end();
			}
		}
	}
}

Print(const message_fmt[], any:...)
{
	if( !get_playersnum() ) return;
	
	static message[192];
	vformat(message, sizeof(message) - 1, message_fmt, 2);
	
	for( new client = 1; client <= g_max_clients; client++ )
	{
		if( !is_user_connected(client) ) continue;
		
		message_begin(MSG_ONE_UNRELIABLE, g_msgid_SayText, _, client);
		write_byte(client);
		write_string(message);
		message_end();
	}
}

Log(const message_fmt[], any:...)
{
	static message[256];
	vformat(message, sizeof(message) - 1, message_fmt, 2);
	
	static filename[96];
	#if defined HISTORY_ONE_FILE
	if( !filename[0] )
	{
		get_basedir(filename, sizeof(filename) - 1);
		add(filename, sizeof(filename) - 1, "/logs/ban_history.log");
	}
	#else
	static dir[64];
	if( !dir[0] )
	{
		get_basedir(dir, sizeof(dir) - 1);
		add(dir, sizeof(dir) - 1, "/logs");
	}
	
	format_time(filename, sizeof(filename) - 1, "%m%d%Y");
	format(filename, sizeof(filename) - 1, "%s/BAN_HISTORY_%s.log", dir, filename);
	#endif
	
	log_amx("%s", message);
	log_to_file(filename, "%s", message);
}

FireBannedForward(target, admin, length, const reason[])
{
	if( g_fwdBanned )
	{
		new dummy;
		ExecuteForward(g_fwdBanned, dummy, target, admin, length, reason);
	}
}

bool:FireCBanPre(target, admin, &length, const reason[])
{
	if( !g_fwdCBanPre ) return true;
	
	new ret;
	ExecuteForward(g_fwdCBanPre, ret, target, admin, length, reason);
	return ret != PLUGIN_HANDLED;
}

FireCBanPost(target, admin, length, const reason[])
{
	if( g_fwdCBanPost )
	{
		new dummy;
		ExecuteForward(g_fwdCBanPost, dummy, target, admin, length, reason);
	}
}

bool:FireCBanAdd(const target[], admin, &length, reason[])
{
	if( !g_fwdCBanAdd ) return true;
	
	new ret;
	ExecuteForward(g_fwdCBanAdd, ret, target, admin, length, reason);
	return ret != PLUGIN_HANDLED;
}

bool:FireCBanOff(const steamid[], admin, &length, reason[])
{
	if( !g_fwdCBanOff ) return true;
	
	new ret;
	ExecuteForward(g_fwdCBanOff, ret, steamid, admin, length, reason);
	return ret != PLUGIN_HANDLED;
}

RescanConnectedPlayers()
{
	for( new i = 1; i <= g_max_clients; i++ )
	{
		if( is_user_connected(i) || is_user_connecting(i) )
			CheckPlayerBan(i, false);
	}
}

public _CBan_BanPlayer(plugin, argc)
{
	if( argc < 4 ) return;
	
	new pid = get_param(2);
	if( !is_user_connected(pid) ) return;
	
	new ban_length = abs(get_param(3));
	new ban_reason[128];
	get_string(4, ban_reason, charsmax(ban_reason));
	replace_all(ban_reason, charsmax(ban_reason), "^"", "'");
	server_cmd("amx_ban #%i %i ^"%s^"", get_user_userid(pid), ban_length, ban_reason);
}

public _CBan_UnbanPlayer(plugin, argc)
{
	if( argc < 3 ) return;
	
	new target[32];
	get_string(2, target, charsmax(target));
	replace_all(target, charsmax(target), "^"", "'");
	server_cmd("amx_unban ^"%s^"", target);
}

public _CBan_OffBanPlayer(plugin, argc)
{
	if( argc < 4 ) return 0;
	
	new target[32];
	get_string(2, target, charsmax(target));
	replace_all(target, charsmax(target), "^"", "'");
	new pid = find_player("bl", target);
	if( pid && (get_user_flags(pid) & ADMIN_IMMUNITY) ) return 0;
	
	new ban_reason[128];
	get_string(4, ban_reason, charsmax(ban_reason));
	replace_all(ban_reason, charsmax(ban_reason), "^"", "'");
	new length = abs(get_param(3));
	
	if( pid )
	{
		if( !FireCBanOff(target, get_param(1), length, ban_reason) ) return 0;
		server_cmd("amx_ban #%i %i ^"%s^"", get_user_userid(pid), length, ban_reason);
		return 1;
	}
	
	return 0;
}

public _CBan_AddBanPlayer(plugin, argc)
{
	if( argc < 4 ) return 0;
	
	new target[32];
	get_string(2, target, charsmax(target));
	replace_all(target, charsmax(target), "^"", "'");
	new ban_reason[128];
	get_string(4, ban_reason, charsmax(ban_reason));
	replace_all(ban_reason, charsmax(ban_reason), "^"", "'");
	new length = abs(get_param(3));
	
	new pid = find_player("cl", target);
	if( !pid ) pid = find_player("d", target);
	
	if( pid )
	{
		if( get_user_flags(pid) & ADMIN_IMMUNITY ) return 0;
		server_cmd("amx_ban #%i %i ^"%s^"", get_user_userid(pid), length, ban_reason);
		return 1;
	}
	
	if( !FireCBanAdd(target, get_param(1), length, ban_reason) ) return 0;
	server_cmd("amx_addban ^"%s^" ^"%s^" %i ^"%s^"", target, target, length, ban_reason);
	return 1;
}
/* AMXX-Studio Notes - DO NOT MODIFY BELOW HERE
*{\\ rtf1\\ ansi\\ deff0{\\ fonttbl{\\ f0\\ fnil Tahoma;}}\n\\ viewkind4\\ uc1\\ pard\\ lang1033\\ f0\\ fs16 \n\\ par }
*/
