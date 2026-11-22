// tests/winterfest/wf_mail_probe.sma — the scripted proof for the envelope.
//
// The plugin under test is winterfest_mail.amxx (workstream 15); this probe is
// the lab harness around it, in the same spirit as wf_scenario.sma: it drives
// the real plugin through its natives and asserts the results, so the inbox can
// be exercised with nobody at the keyboard.
//
// The vault persists between harness runs on purpose (that is what a vault does),
// so every assertion is a DELTA or uses ids minted for this run — the probe never
// assumes an empty cache.
//
// WHAT IT PROVES
//   deliver-once       one panel message lands, and the same panel id again is a
//                      no-op (WF_MAIL_EXISTS) — the idempotency contract
//   one-row-only       the duplicate did not add a second row
//   unread-count       wfm_unread() counts the new unread message
//   expired-hidden     a message whose expires_at is in the past is invisible
//   index-lookup       wfm_find() locates the delivered message
//   mail-show-called   the read path (MailShow, the menu's own function) runs
//   read-report        wfm_reads() then reports "id@read_at" for the panel
//   unread-after-read  the count drops by exactly one
//   read-is-idempotent opening the same message again changes nothing
//
// RUN (cs16-linux-base harness, profile freenova; the plugin line has to be in
// the build tree because the profile keeps its own plugin list):
//   printf 'winterfest_mail.amxx\n' >> build/server-freenova/cstrike/addons/amxmodx/configs/plugins.ini
//   ./scripts/test-plugin.sh /path/to/tests/winterfest/wf_mail_probe.sma --profile freenova --bots 1
// Expected: RESULT ok, with the PASS lines in wf_mail_probe.expect.
#include <amxmodx>
#include <winterfest_mail>

#define PLUGIN  "WF Mail Probe"
#define VERSION "1.0.0"
#define AUTHOR  "FreeNova"

#define PROBE_TICK_ID 7331

new g_iStep
new g_iTries
new g_iPanelId
new g_iCountBefore
new g_iUnreadBefore
new g_iCountAfter

// ------------------------------------------------------------------ utils ---
/** The first connected, non-HLTV client (the harness runs YAPB bots). */
ProbeClient()
{
	new players[MAX_PLAYERS], num
	// Empty flags on purpose: the letters ("c"/"h"/"d") mean different things in
	// different AMXX builds (wf_scenario.sma uses "d" for bots-only), so every
	// filter here is explicit.
	get_players(players, num, "")
	for (new i = 0; i < num; i++)
	{
		new id = players[i]
		if (id < 1 || id > MaxClients)
			continue
		if (is_user_hltv(id) || !is_user_connected(id))
			continue
		return id
	}
	return 0
}

ProbeDone()
{
	remove_task(PROBE_TICK_ID)
}

// ----------------------------------------------------------------- plugin ---
public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)
	server_print("[CS16TEST] init")
	// The harness boots, adds its bots and shuts down inside ~15 s, so the probe
	// looks for a client every half second and runs the scenario the moment one
	// is in the game — no polite waiting.
	set_task(0.5, "Task_Tick", PROBE_TICK_ID, "", 0, "b")
}

public Task_Tick()
{
	g_iTries++
	if (g_iTries == 1)
		server_print("[CS16TEST] tick")

	new id = ProbeClient()
	if (!id)
	{
		if (g_iTries % 10 == 0)
			server_print("[WF-MAIL-PROBE] waiting for a client (tick %d)", g_iTries)
		if (g_iTries >= 60)
		{
			server_print("[WF-MAIL-PROBE] FAIL no-client")
			ProbeDone()
		}
		return
	}

	switch (g_iStep)
	{
		case 0:
		{
			new szAuth[40]
			get_user_authid(id, szAuth, charsmax(szAuth))
			server_print("[WF-MAIL-PROBE] client=%s", szAuth[0] ? szAuth : "<none>")

			// Ids unique to this run: the vault keeps whatever previous runs (or
			// a real season) left behind, so nothing below assumes an empty cache.
			g_iPanelId = 90000 + (get_systime() % 9000)
			g_iCountBefore = wfm_count(id)
			g_iUnreadBefore = wfm_unread(id)

			new r1 = wfm_deliver(id, g_iPanelId, MAIL_KIND_SYSTEM, 0, 0, "probe: first message")
			g_iCountAfter = wfm_count(id)
			new r2 = wfm_deliver(id, g_iPanelId, MAIL_KIND_SYSTEM, 0, 0, "probe: first message again")
			if (r1 == WF_MAIL_ADDED && r2 == WF_MAIL_EXISTS)
				server_print("[WF-MAIL-PROBE] PASS deliver-once")
			else
				server_print("[WF-MAIL-PROBE] FAIL deliver-once (first=%d second=%d)", r1, r2)

			// A full cache drops its oldest row, so the duplicate check is a delta
			// against the count taken right after the first delivery.
			if (wfm_count(id) == g_iCountAfter)
				server_print("[WF-MAIL-PROBE] PASS one-row-only (%d)", g_iCountAfter)
			else
				server_print("[WF-MAIL-PROBE] FAIL one-row-only (after=%d now=%d)",
					g_iCountAfter, wfm_count(id))

			if (wfm_unread(id) == g_iUnreadBefore + 1)
				server_print("[WF-MAIL-PROBE] PASS unread-count (%d -> %d)",
					g_iUnreadBefore, wfm_unread(id))
			else
				server_print("[WF-MAIL-PROBE] FAIL unread-count (before=%d now=%d)",
					g_iUnreadBefore, wfm_unread(id))

			// Expired on arrival: it is never counted as unread.
			wfm_deliver(id, g_iPanelId + 1, MAIL_KIND_EVENT, 0, 100, "probe: already expired")
			if (wfm_unread(id) == g_iUnreadBefore + 1)
				server_print("[WF-MAIL-PROBE] PASS expired-hidden")
			else
				server_print("[WF-MAIL-PROBE] FAIL expired-hidden (unread=%d)", wfm_unread(id))

			if (wfm_find(id, g_iPanelId) >= 0)
				server_print("[WF-MAIL-PROBE] PASS index-lookup")
			else
				server_print("[WF-MAIL-PROBE] FAIL index-lookup")

			g_iStep = 1
		}
		case 1:
		{
			// The read path itself: the same function the chat menu calls, on the
			// index wfm_find() just returned.
			new index = wfm_find(id, g_iPanelId)
			new found = callfunc_begin("MailShow", "winterfest_mail")
			if (found == 1 && index >= 0)
			{
				callfunc_push_int(id)
				callfunc_push_int(index)
				callfunc_end()
				server_print("[WF-MAIL-PROBE] PASS mail-show-called (index=%d)", index)
			}
			else
			{
				server_print("[WF-MAIL-PROBE] FAIL mail-show-called (begin=%d index=%d)", found, index)
			}

			new szReads[256], szNeedle[24]
			wfm_reads(id, szReads, charsmax(szReads))
			formatex(szNeedle, charsmax(szNeedle), "%d@", g_iPanelId)
			// Anywhere in the report, not necessarily first: an older run's
			// message may still be ahead of this one in the list.
			if (strlen(szReads) > 0 && contain(szReads, szNeedle) >= 0)
				server_print("[WF-MAIL-PROBE] PASS read-report (%s)", szReads)
			else
				server_print("[WF-MAIL-PROBE] FAIL read-report (%s)", szReads)

			if (wfm_unread(id) == g_iUnreadBefore)
				server_print("[WF-MAIL-PROBE] PASS unread-after-read (%d)", wfm_unread(id))
			else
				server_print("[WF-MAIL-PROBE] FAIL unread-after-read (before=%d now=%d)",
					g_iUnreadBefore, wfm_unread(id))

			// A second read of the same message is a no-op, not a second report.
			if (callfunc_begin("MailShow", "winterfest_mail") == 1)
			{
				callfunc_push_int(id)
				callfunc_push_int(index)
				callfunc_end()
			}
			new szAgain[256]
			wfm_reads(id, szAgain, charsmax(szAgain))
			if (equal(szAgain, szReads))
				server_print("[WF-MAIL-PROBE] PASS read-is-idempotent")
			else
				server_print("[WF-MAIL-PROBE] FAIL read-is-idempotent (%s)", szAgain)

			server_print("[WF-MAIL-PROBE] done")
			ProbeDone()
		}
	}
}
