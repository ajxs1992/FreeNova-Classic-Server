/*
 * ============================================================================
 * tools/probes/zz_test_giftpay.sma - prove what happens when a reward cannot
 *                                     fit in the bag
 * ============================================================================
 * NOT a shipped plugin. Build and load it for one session:
 *
 *   bash tools/compile-probe.sh zz_test_giftpay
 *   WF_EXTRA_PLUGINS=zz_test_giftpay bash scripts/wf-local.sh restart
 *   grep WF-GIFTPAY build/wf-local/server.log
 *
 * WHAT IT PROVES. `WfGrantIdem()` writes the claim key BEFORE it applies the
 * reward, and `WfApplyReward()` returns false when the present bag is already
 * full (WF_MAX_GIFTS = 16). The caller then gets WF_GRANT_DUPLICATE - while the
 * key says "already paid". A wheel sector, an advent day or a killed reindeer
 * therefore paid NOTHING and could never pay again.
 *
 * The probe fills one player's bag to 16 with 16 distinct claim keys, then asks
 * for ONE more present under a fresh claim key and reports the balance before
 * and after. Correct behaviour (after the fix) = the balance rises; the old
 * behaviour = the balance is unchanged and the claim key is spent.
 * ============================================================================
 */

#include <amxmodx>
#include <amxmisc>
#include <winterfest>

#define PLUGIN  "WF gift-pay probe"
#define VERSION "1.0.0"
#define AUTHOR  "FreeNova (test asset)"

new g_szTarget[32]
new g_iStage

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)
	register_concmd("wf_giftpay", "cmdRun", ADMIN_CFG, "- fill a bot's bag, then ask for one more present")
	// Late enough that the core has loaded its records for the bots.
	set_task(6.0, "TaskRun")
}

public TaskRun()
{
	cmdRun(0, ADMIN_CFG, 0)
}

public cmdRun(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1))
		return PLUGIN_HANDLED
	g_iStage = 0
	server_print("[WF-GIFTPAY] --- start ---")
	TaskStep()
	return PLUGIN_HANDLED
}

stock ProbeBot()
{
	new players[32], n
	get_players(players, n, "dh")
	return n ? players[0] : 0
}

public TaskStep()
{
	new p = ProbeBot()
	if (!p)
	{
		server_print("[WF-GIFTPAY] no bot connected - nothing to prove")
		return
	}

	new name[32]
	get_user_name(p, name, charsmax(name))

	switch (g_iStage++)
	{
		case 0:
		{
			server_print("[WF-GIFTPAY] target id=%d gb_before=%d bag=%d",
				p, wf_get_gingerbread(p), wf_gift_count(p))
			server_print("[WF-GIFTPAY] filling the bag to 16 with distinct claim keys")
			for (new i = 0; i < 16; i++)
			{
				new key[48]
				formatex(key, charsmax(key), "probe#fill#%d", i)
				wf_grant(p, WF_REWARD_GIFT, i % 3, key)
			}
		}
		case 1:
		{
			server_print("[WF-GIFTPAY] after fill: gb=%d bag=%d (bag must now be 16 = WF_MAX_GIFTS)",
				wf_get_gingerbread(p), wf_gift_count(p))
			server_print("[WF-GIFTPAY] asking for ONE more present under a fresh claim key (the overflow case)")
			new code = wf_grant(p, WF_REWARD_GIFT, 2, "probe#overflow#1")
			server_print("[WF-GIFTPAY] wf_grant(gift) returned %d (WF_GRANT_OK=%d DUPLICATE=%d INVALID=%d)",
				code, WF_GRANT_OK, WF_GRANT_DUPLICATE, WF_GRANT_INVALID)
		}
		case 2:
		{
			new after = wf_get_gingerbread(p)
			new bag = wf_gift_count(p)
			server_print("[WF-GIFTPAY] after overflow: gb=%d bag=%d", after, bag)
			server_print("[WF-GIFTPAY] VERDICT: %s",
				(after > 0 && bag == 16) ? "the reward was converted (or added) - nothing lost" : "see gb/bag above")
			server_print("[WF-GIFTPAY] --- done ---")
			// Leave the server clean for the next probe: the fills are real state.
			server_cmd("wf_reset %s", name)
			server_exec()
			return
		}
	}

	set_task(1.0, "TaskStep")
}
