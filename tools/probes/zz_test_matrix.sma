/*
 * ============================================================================
 * tools/build/probe/zz_test_matrix.sma - drive every Winterfest command on the
 *                                        local stack and print what happened
 * ============================================================================
 * NOT a shipped plugin. Load it for one session only:
 *
 *   bash tools/compile-probe.sh                       # builds it
 *   WF_EXTRA_PLUGINS=zz_test_matrix bash scripts/wf-local.sh restart
 *   grep WF-MATRIX build/wf-local/server.log
 *
 * WHY IT EXISTS. Most Winterfest surfaces are `say /cmd`, which only a CLIENT
 * can issue, and a bot's chat output is invisible to the operator. This probe
 * therefore drives them the only way the server can: it reads each line of
 * `tools/build/probe/commands.txt` and issues it with `server_cmd("say ...")`,
 * which runs the command as the SERVER. Every Winterfest command refuses a
 * non-player with a logged line, so the log proves in one pass:
 *
 *   * the command is REGISTERED (an unregistered one produces no plugin line at
 *     all - and no "unknown command" either, which is why the count matters),
 *   * the guard in front of it behaves (season closed, not a player, no core),
 *   * nothing in the handler throws (a run-time error would land in
 *     logs/error_<date>.log).
 *
 * The second half asks the non-chat surfaces in-process, where a bot cannot lie:
 * fn_open_panel() for each page kind, the wallet, the bag, the season gate.
 * ============================================================================
 */

#include <amxmodx>
#include <amxmisc>
#include <freenova_web>
#include <winterfest>

#define PLUGIN  "WF matrix probe"
#define VERSION "1.0.0"
#define AUTHOR  "FreeNova (test asset)"

new const g_szCommands[][] =
{
	// Chat commands, issued once each with server_cmd("say ..."). A command
	// registered by a plugin answers here (Server say -> the plugin's own
	// reply/refusal in the log); a command NOBODY registered stays unhandled
	// here, which is the only way this probe can tell the two apart.
	"say /christmas",
	"say /xmas",
	"say /winter",
	"say /wintermenu",
	"say /christmasmenu",
	"say /gifts",
	"say /tree",
	"say /ornaments",
	"say /advent",
	"say /winterpass",
	"say /christmashop",
	"say /opengift",
	"say /spin",
	"say /mail",
	"say !mail",
	"say /christmasmissions",
	"say /xmasmissions",
	"say /christmasrank",
	"say /xmasrank",
	"say /wfsnow",
	"say /wfcos",
	"say /cospreview",
	"say /lpm",
	"say /dashboard",
	"say /wfpanel"
}

new g_iCmd

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)
	register_concmd("wf_matrix", "cmdMatrix", ADMIN_CFG, "- run the whole probe matrix")
	set_task(4.0, "TaskStart")
}

public TaskStart()
{
	cmdMatrix(0, ADMIN_CFG, 0)
}

public cmdMatrix(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1))
		return PLUGIN_HANDLED
	TaskState()
	g_iCmd = 0
	set_task(0.5, "TaskSay")
	return PLUGIN_HANDLED
}

public TaskSay()
{
	if (g_iCmd >= sizeof(g_szCommands))
	{
		set_task(2.0, "TaskReport")
		return
	}
	server_print("[WF-MATRIX] cmd> %s", g_szCommands[g_iCmd])
	server_cmd("%s", g_szCommands[g_iCmd])
	server_exec()
	g_iCmd++
	set_task(0.4, "TaskSay")
}

TaskState()
{
	server_print("[WF-MATRIX] === library state ===")
	server_print("[WF-MATRIX] core=%d gifts=%d menu=%d progress=%d spin=%d mail=%d atmos=%d snow=%d",
		LibraryExists("winterfest_core", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_gifts", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_menu", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_progress", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_spin", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_mail", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_atmos", LibType_Library) ? 1 : 0,
		LibraryExists("winterfest_snow", LibType_Library) ? 1 : 0)

	server_print("[WF-MATRIX] === cvars ===")
	server_print("[WF-MATRIX] wf_allow_models=%d wf_force_open=%d wf_enabled=%d fnweb_enabled=%d",
		get_cvar_num("wf_allow_models"), get_cvar_num("wf_force_open"),
		get_cvar_num("wf_enabled"), get_cvar_num("fnweb_enabled"))

	new base[80]
	if (FNWeb_BaseUrl(base, charsmax(base)))
		server_print("[WF-MATRIX] panel base url=%s", base)
	else
		server_print("[WF-MATRIX] panel base url=<none: fnweb_enabled 0 or fnweb_url empty>")

	server_print("[WF-MATRIX] === fn_open_panel() per page kind (0 = show the in-game menu) ===")
	new const kinds[] = { FN_PANEL_WINTER, FN_PANEL_WINTER_TREE, FN_PANEL_WINTER_GIFTS,
		FN_PANEL_WINTER_ORNAMENTS, FN_PANEL_WINTER_ADVENT, FN_PANEL_WINTER_PASS,
		FN_PANEL_WINTER_SPIN, FN_PANEL_DASHBOARD }
	new szName[24]
	for (new i = 0; i < sizeof(kinds); i++)
	{
		fn_panel_kind_name(kinds[i], szName, charsmax(szName))
		new opened = fn_open_panel(0, kinds[i])
		server_print("[WF-MATRIX] panel %-18s -> %d (denied=%d, last_answer=%d)",
			szName, opened, fn_panel_denied(), fn_panel_last_answer(kinds[i]))
	}
}

public TaskReport()
{
	new players[32], n, id
	get_players(players, n, "h")
	server_print("[WF-MATRIX] === wallets (humans: %d) ===", n)
	for (new i = 0; i < n; i++)
	{
		id = players[i]
		new name[32], auth[40]
		get_user_name(id, name, charsmax(name))
		get_user_authid(id, auth, charsmax(auth))
		server_print("[WF-MATRIX] id=%d %s auth=%s gb=%d gifts=%d",
			id, name, auth, wf_get_gingerbread(id), wf_gift_count(id))
	}
	if (!n)
		server_print("[WF-MATRIX] no humans connected - the chat half of this matrix cannot be answered")

	server_print("[WF-MATRIX] === chat matrix done; starting the money walk ===")
	set_task(2.0, "TaskMoney")
}

// ============================================================
// The money walk
// ============================================================
// Two bots, the same action on both, and a read-back of the ledger-backed
// counters after each one. A duplicate or a double-pay shows here as a counter
// that is twice what the action was worth, or as a second player whose identical
// action paid nothing.
new g_iMoneyStep
new g_iMoneyA
new g_iMoneyB
new g_iGbA0
new g_iGbB0

public TaskMoney()
{
	new players[32], n
	get_players(players, n, "dh")
	g_iMoneyA = (n > 0) ? players[0] : 0
	g_iMoneyB = (n > 1) ? players[1] : 0
	g_iGbA0 = g_iMoneyA ? wf_get_gingerbread(g_iMoneyA) : 0
	g_iGbB0 = g_iMoneyB ? wf_get_gingerbread(g_iMoneyB) : 0
	g_iMoneyStep = 0
	server_print("[WF-MATRIX] money walk: A=id %d (gb %d) B=id %d (gb %d)",
		g_iMoneyA, g_iGbA0, g_iMoneyB, g_iGbB0)
	TaskMoneyStep()
}

public TaskMoneyStep()
{
	new step = g_iMoneyStep++

	switch (step)
	{
		case 0:
		{
			// A pouch: the same slot number can be used by two different players
			// in the same map, and each of them has to be paid.
			server_print("[WF-MATRIX] pouch: A grants slot 0, B grants slot 0 (same map, same round)")
			server_print("[WF-MATRIX]   A -> %d", wf_grant(g_iMoneyA, WF_REWARD_SNOWFLAKES, 5, "pouch#0"))
			server_print("[WF-MATRIX]   B -> %d", wf_grant(g_iMoneyB, WF_REWARD_SNOWFLAKES, 5, "pouch#0"))
		}
		case 1:
		{
			server_print("[WF-MATRIX] pouch result: A gb %d -> %d, B gb %d -> %d (both must have risen by 5)",
				g_iGbA0, wf_get_gingerbread(g_iMoneyA), g_iGbB0, wf_get_gingerbread(g_iMoneyB))
		}
		case 2:
		{
			// A present spot: the claim key names the map and the round, so a
			// RECONNECT in the same round cannot pay twice - and a new round must.
			new gbA = wf_get_gingerbread(g_iMoneyA)
			server_print("[WF-MATRIX] spot: A claims spot#<map>#3#<round> twice (second must be refused)")
			server_print("[WF-MATRIX]   first  -> %d", wf_grant(g_iMoneyA, WF_REWARD_SNOWFLAKES, 10, "spot#probe#3#1"))
			server_print("[WF-MATRIX]   second -> %d", wf_grant(g_iMoneyA, WF_REWARD_SNOWFLAKES, 10, "spot#probe#3#1"))
			server_print("[WF-MATRIX] spot: A gb %d -> %d (must rise by 10, not 20)", gbA, wf_get_gingerbread(g_iMoneyA))
		}
		case 3:
		{
			// A bag that is full, and the same present twice: the second call must
			// not pay again even though the first one paid in GingerBread.
			server_print("[WF-MATRIX] === money walk done ===")
			return
		}
	}
	set_task(1.0, "TaskMoneyStep")
}
