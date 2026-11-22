/* fn_audit: case IDs + destructive-action confirmations over fn_core append.
 * Cases live in a memory ring (last 32) plus the permanent amxx log lines.
 * Confirm entries expire after FN_CONFIRM_TIMEOUT seconds. */
#include <amxmodx>
#include <amxmisc>
#include <fn_core>

#define MAX_CASES 32

new g_cases[MAX_CASES][FN_CASE_LEN];
new g_caseAdmin[MAX_CASES];
new g_caseHead;
new g_seq;
new g_lastDate[12];
new Trie:g_confirm;
new g_lastCase[24];
new g_cvarLastCase;
new g_cvarCasesFile;

public plugin_natives()
{
	set_native_filter("native_filter");
	register_library("fn_audit");
	register_native("fn_case_new", "_case_new");
	register_native("fn_confirm_request", "_confirm_request");
	register_native("fn_confirm_do", "_confirm_do");
	register_native("fn_ban_last_case", "_ban_last_case");
	register_native("fn_case_note", "_case_note");
}

public native_filter(const name[], index, trap)
{
	if (!trap && contain(name, "fn_") == 0)
		return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
}

public plugin_init()
{
	register_plugin("FreeNova Audit", "2.0.0", "FreeNova");
	g_confirm = TrieCreate();
	g_cvarLastCase = register_cvar("fn_audit_last_case", "");
	g_cvarCasesFile = register_cvar("fn_cases_file", "fn_cases.log");
	register_concmd("fn_cases", "cmdCases", ADMIN_ADMIN, "- recent case IDs");
	if( !LibraryExists("fn_core", LibType_Library) )
	{
		log_amx("[FN-AUDIT] fn_core missing, pausing self");
		pause("d");
		return;
	}
	fn_health_set("audit", "ok");
}

public _case_new(plugin, params)
{
	new outlen = get_param(3);
	new date[12];
	get_time("%Y%m%d", date, charsmax(date));
	if( !equal(date, g_lastDate) )
	{
		copy(g_lastDate, charsmax(g_lastDate), date);
		g_seq = 0;
	}
	g_seq++;
	static id[FN_CASE_LEN];
	formatex(id, charsmax(id), "FN-%s-%04d", date, g_seq % 10000);
	copy(g_cases[g_caseHead % MAX_CASES], FN_CASE_LEN - 1, id);
	g_caseAdmin[g_caseHead % MAX_CASES] = get_param(1);
	g_caseHead++;
	set_string(2, id, outlen);
	copy(g_lastCase, 23, id);
	set_pcvar_string(g_cvarLastCase, id);
	journalEvent("new", id, get_param(1), 0, "", "");
	return 1;
}

new g_cfSteam[MAX_CASES][40];
new g_cfIp[MAX_CASES][32];
new g_cfMins[MAX_CASES];
new g_cfReason[MAX_CASES][96];
new g_cfAdminKey[MAX_CASES][35];

findCaseSlot(const case_id[])
{
	for( new i = 0; i < MAX_CASES; i++ )
		if( equal(g_cases[i], case_id) ) return i;
	return -1;
}

public _confirm_request(plugin, params)
{
	new admin = get_param(1);
	new case_id[24], what[96], steam[40], ip[32], reason[96];
	new minutes = get_param(4);
	get_string(2, case_id, charsmax(case_id));
	get_string(3, what, charsmax(what));
	get_string(5, steam, charsmax(steam));
	get_string(6, ip, charsmax(ip));
	get_string(7, reason, charsmax(reason));
	if( !case_id[0] ) return 0;
	new slot = findCaseSlot(case_id);
	if( slot < 0 ) return 0;
	copy(g_cfSteam[slot], 39, steam);
	copy(g_cfIp[slot], 31, ip);
	g_cfMins[slot] = minutes;
	copy(g_cfReason[slot], 95, reason);
	if( admin > 0 && is_user_connected(admin) )
		get_user_authid(admin, g_cfAdminKey[slot], 34);
	else copy(g_cfAdminKey[slot], 34, "CONSOLE");
	TrieSetCell(g_confirm, case_id, get_systime());
	if( admin > 0 && is_user_connected(admin) )
		client_print(admin, print_console, "[FN] confirm %s within %ds: fn_confirm %s", what, FN_CONFIRM_TIMEOUT, case_id);
	log_amx("[FN-AUDIT] confirm requested case=%s what=%s", case_id, what);
	journalEvent("request", case_id, admin, 0, what, reason);
	return 1;
}

public _confirm_do(plugin, params)
{
	new admin = get_param(1);
	new case_id[24];
	get_string(2, case_id, charsmax(case_id));
	new sLen = get_param(4), iLen = get_param(6), mLen = get_param(8), rLen = get_param(10);
	new at = 0;
	if( !TrieGetCell(g_confirm, case_id, at) ) return 0;
	if( get_systime() - at > FN_CONFIRM_TIMEOUT ) { TrieDeleteKey(g_confirm, case_id); return 0; }
	new slot = findCaseSlot(case_id);
	if( slot < 0 ) return 0;
	new akey[35];
	if( admin > 0 && is_user_connected(admin) )
	{
		get_user_authid(admin, akey, charsmax(akey));
		if( !equal(akey, g_cfAdminKey[slot]) && !(get_user_flags(admin) & ADMIN_RCON) ) return 0;
	}
	TrieDeleteKey(g_confirm, case_id);
	journalEvent("grant", case_id, admin, 0, "", "");
	set_string(3, g_cfSteam[slot], sLen);
	set_string(5, g_cfIp[slot], iLen);
	new ms[12];
	num_to_str(g_cfMins[slot], ms, charsmax(ms));
	set_string(7, ms, mLen);
	set_string(9, g_cfReason[slot], rLen);
	return 1;
}

public _ban_last_case(plugin, params)
{
	new outlen = get_param(2);
	new lcbuf[24];
	get_cvar_string("fn_audit_last_case", lcbuf, 23);
	set_string(1, lcbuf, outlen);
	return lcbuf[0] ? 1 : 0;
}

/* M2 durable cases v1: append-only journal (datadir/fn_cases_file).
 * Case lifecycle only (new/request/grant/note), not every audit line.
 * Line: time|server|event|case|admin|target|action|detail (pipes stripped). */
journalEvent(const event[], const case_id[], admin, target, const action[], const detail[])
{
	new dir[96], fname[64], path[192];
	get_datadir(dir, charsmax(dir));
	get_pcvar_string(g_cvarCasesFile, fname, charsmax(fname));
	if (!fname[0]) copy(fname, charsmax(fname), "fn_cases.log");
	formatex(path, charsmax(path), "%s/%s", dir, fname);
	new f = fopen(path, "at");
	if (!f) return;
	new ec[32], cc[28], ac[64], dc[192];
	copy(ec, charsmax(ec), event); copy(cc, charsmax(cc), case_id);
	copy(ac, charsmax(ac), action); copy(dc, charsmax(dc), detail);
	replace_all(ec, charsmax(ec), "|", " "); replace_all(cc, charsmax(cc), "|", " ");
	replace_all(ac, charsmax(ac), "|", " "); replace_all(dc, charsmax(dc), "|", " ");
	replace_all(dc, charsmax(dc), "^n", " ");
	new stamp[24]; get_time("%Y-%m-%d %H:%M:%S", stamp, charsmax(stamp));
	new srv[32]; get_cvar_string("fn_server_id", srv, charsmax(srv));
	if (!srv[0]) copy(srv, charsmax(srv), "fn-01");
	new line[512];
	formatex(line, charsmax(line), "%s|%s|%s|%s|%d|%d|%s|%s^n", stamp, srv, ec, cc, admin, target, ac, dc);
	fputs(f, line);
	fclose(f);
}

public _case_note(plugin, params)
{
	new admin = get_param(1);
	new case_id[24], note[128];
	get_string(2, case_id, charsmax(case_id));
	get_string(3, note, charsmax(note));
	if (!case_id[0] || !note[0]) return 0;
	if (findCaseSlot(case_id) < 0) return 0;
	replace_all(note, charsmax(note), "^n", " ");
	replace_all(note, charsmax(note), "^r", " ");
	replace_all(note, charsmax(note), "|", " ");
	journalEvent("note", case_id, admin, 0, "", note);
	fn_audit_append(case_id, admin, 0, "case.note", note);
	return 1;
}

public plugin_end()
{
	TrieDestroy(g_confirm);
}

public cmdCases(id, level, cid)
{
	if( !cmd_access(id, level, cid, 1) ) return PLUGIN_HANDLED;
	console_print(id, "[FN] recent cases (memory ring, full trail in logs):");
	new n = (g_caseHead < MAX_CASES) ? g_caseHead : MAX_CASES;
	for( new i = 0; i < n; i++ )
		console_print(id, "  %s", g_cases[i]);
	return PLUGIN_HANDLED;
}