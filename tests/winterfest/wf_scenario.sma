/*
 * ============================================================================
 * tests/winterfest/wf_scenario.sma - the scripted Winterfest core scenario
 * ============================================================================
 * Run with the freenova profile, one bot, and the three Winterfest plugins
 * already in the build tree's plugins.ini (see tests/winterfest/README.md):
 *
 *   ./scripts/test-plugin.sh tests/winterfest/wf_scenario.sma --profile freenova --bots 1
 *
 * WHAT IT PROVES, WITHOUT A HUMAN
 *   1. a currency add lands, and the same claim key twice pays ONCE;
 *   2. an ornament is granted once, and the tree grid accepts it once;
 *   3. a present is granted once, and the SAME present opened twice in the
 *      same tick pays once (the anti-dupe rule, WINTERFEST.md §5.2);
 *   4. a second, different present still pays (the gate is per present, not
 *      global - a bug here would look like "presents stopped working");
 *   5. an advent day pays once: today full, a missed day late, a future day
 *      refused;
 *   6. Winter Pass XP moves the tier and the tier reward is claimed once.
 *
 * Every assertion is a DELTA, never an absolute balance: the harness sends
 * `wf_give all` at the same time and the two must not be able to make each
 * other flaky.
 *
 * Bots are the test subject (the harness has nobody else), which is fine: the
 * "bots must not collect" rule lives in the pickup/opening entry points of
 * winterfest_gifts, not in the core's ledger.
 * ============================================================================
 */

#include <amxmodx>
#include <engine>     // engfunc(EngFunc_FindEntityByString) - the world-side assertion
#include <fakemeta>   // pev(ent, pev_classname / pev_model)
#include <winterfest>

#define PLUGIN  "WF Scenario"
#define VERSION "1.0.0"
#define AUTHOR  "FreeNova"

enum
{
	TASK_TRY = 95000
}

new g_iTries;
new g_iPass;
new g_iFail;
new bool:g_bRan;

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR)
	server_print("[CS16TEST] init")
	// The bot is added by the harness a couple of seconds after the round
	// starts, so the scenario starts from the round, not from plugin_init.
	register_event("HLTV", "evRoundStart", "a", "1=0", "2=0")
}

public evRoundStart()
{
	if (g_bRan)
		return
	set_task(0.5, "TaskTry", TASK_TRY)
}

public TaskTry(taskid)
{
	#pragma unused taskid
	if (g_bRan)
		return

	if (!LibraryExists("winterfest_core", LibType_Library))
	{
		report("core-loaded", false, "winterfest_core is not loaded")
		finish()
		return
	}

	// A bot to act on. The harness adds it after the round starts, so retry.
	new players[MAX_PLAYERS], num
	get_players(players, num, "d")     // "d" = do not include human clients
	if (!num)
	{
		g_iTries++
		if (g_iTries < 24)
		{
			set_task(0.5, "TaskTry", TASK_TRY)
			return
		}
		report("bot-present", false, "no bot appeared in 12s")
		finish()
		return
	}

	run(players[0])
	finish()
}

run(bot)
{
	// Clean slate first, through the operator command (wf_reset), because the
	// harness reuses one vault across runs: without this the second run would
	// see the first run's claim keys and every assertion below would be a
	// duplicate. It also proves wf_reset works, and its epoch bump is what makes
	// a reset player able to earn everything again.
	server_cmd("wf_reset all")
	server_exec()
	report("reset-clean",
		(wf_gift_count(bot) == 0 && wf_ornament_count(bot) == 0 && wf_get_pass_xp(bot) == 0) ? true : false,
		"wf_reset all left state behind")

	// Out-of-season switch: this test runs in November against a December
	// window. It is the same cvar an operator uses to keep a season open.
	server_cmd("wf_force_open 1")
	server_exec()

	report("season-open", wf_season_open() ? true : false, "wf_force_open did not open the season")

	// The free track pays independently of the premium one (same tier, other
	// claim key). This is the first pass action in the run: nothing has paid tier
	// 1 yet, so the first claim is a real payment (a present can roll pass XP
	// later, and that pays reached free tiers automatically).
	new free1 = wf_claim_pass_tier(bot, 1, false)
	new free2 = wf_claim_pass_tier(bot, 1, false)
	report("pass-free-claim",
		(free1 == WF_GRANT_OK && free2 == WF_GRANT_DUPLICATE) ? true : false,
		"the free tier must pay once and then refuse")

	// The presents are spawned by winterfest_gifts when the season is open. At
	// boot it was closed (the window starts on 1 December), so this is the
	// operator path that brings them into the world: wf_reload re-reads the
	// config and asks the gifts module to re-spawn its spots. The expect file
	// asserts both halves - "season is closed ... not spawned" at boot, and
	// "spawned N/N" after this.
	server_cmd("wf_reload")
	server_exec()

	// ---- 1. currency: add, then the same claim key twice -------------------
	new s0 = wf_get_gingerbread(bot)
	wf_add_gingerbread(bot, 100)
	new s1 = wf_get_gingerbread(bot)
	report("gb-add", (s1 - s0 == 100) ? true : false, "delta was not 100")

	new g1 = wf_grant(bot, WF_REWARD_SNOWFLAKES, 50, "wftest#snow-a")
	new s2 = wf_get_gingerbread(bot)
	new g2 = wf_grant(bot, WF_REWARD_SNOWFLAKES, 50, "wftest#snow-a")
	new s3 = wf_get_gingerbread(bot)
	report("grant-once", (g1 == WF_GRANT_OK && g2 == WF_GRANT_DUPLICATE && s2 - s1 == 50 && s3 == s2) ? true : false,
		"codes 1/0 and exactly one payment expected")

	// A different claim key still pays - the ledger is per claim, not global.
	new g3 = wf_grant(bot, WF_REWARD_SNOWFLAKES, 25, "wftest#snow-b")
	new s4 = wf_get_gingerbread(bot)
	report("grant-second-key", (g3 == WF_GRANT_OK && s4 - s3 == 25) ? true : false, "a new claim key must pay")

	// The deprecated alias must still work for one season and must land on the
	// same counter (owner rename: snowflakes -> GingerBread).
	new before_alias = wf_get_gingerbread(bot)
	wf_add_snowflakes(bot, 5)
	new after_alias = wf_get_gingerbread(bot)
	report("gb-legacy-alias", (after_alias - before_alias == 5) ? true : false,
		"wf_add_snowflakes must still add to the GingerBread balance")

	// ---- 1b. spins: a balance the wheel consumes ---------------------------
	new spin0 = wf_get_spins(bot)
	wf_add_spins(bot, 2)
	new c1s = wf_consume_spin(bot)
	new c2s = wf_consume_spin(bot)
	new c3s = wf_consume_spin(bot)
	report("spins-consume",
		(spin0 == 0 && c1s == 1 && c2s == 1 && c3s == 0 && wf_get_spins(bot) == 0) ? true : false,
		"two spins must be consumable and the third must be refused")

	// ---- 2. ornament + the tree grid --------------------------------------
	new o0 = wf_ornament_count(bot)
	new a1 = wf_grant_ornament(bot, 1)
	new a2 = wf_grant_ornament(bot, 1)
	new o1 = wf_ornament_count(bot)
	report("ornament-once",
		(a1 == 1 && a2 == 0 && o1 - o0 == 1 && wf_has_ornament(bot, 1) == 1) ? true : false,
		"the second grant of the same ornament must not count")

	new t1 = wf_tree_set_slot(bot, 1, 1)
	new filled = wf_tree_filled(bot)
	report("tree-slot",
		(t1 == WF_GRANT_OK && wf_tree_slot(bot, 1) == 1 && filled >= 1) ? true : false,
		"placing an owned ornament in slot 1 failed")

	new t2 = wf_tree_set_slot(bot, 2, 2)
	report("tree-slot-refused", (t2 == WF_GRANT_INVALID) ? true : false,
		"an ornament the player does not own must be refused")

	new t3 = wf_tree_set_slot(bot, 1, 0)
	report("tree-clear", (t3 == WF_GRANT_OK && wf_tree_slot(bot, 1) == 0) ? true : false,
		"clearing a slot with ornament 0 failed")
	// Put it back so the fill count in the log is the interesting one.
	wf_tree_set_slot(bot, 1, 1)

	// ---- 2b. visuals: the look is data, and a model needs its file ----------
	// The owner's hand-over (thirdparty/winterfest-assets/README.md) asks for the
	// present to be a visual_id in the config, not a hardcoded sprite. The
	// playtest batch made the shipped model the default, so what is asserted here
	// is the RULE, whatever the server is configured to do:
	//   wf_allow_models on  -> the prop resolves to the model, and that file is
	//                          the shipped one (models/winterfest/present.mdl);
	//   wf_allow_models off -> the same prop resolves down to its stock sprite.
	// A run with the model file missing is the first branch with the gate on,
	// where the core falls back to the sprite exactly like the second branch.
	new bool:bModels = (get_cvar_num("wf_allow_models") != 0) ? true : false
	new vis[32], asset[64]
	wf_visual_id(WF_PROP_PRESENT_RARE, vis, charsmax(vis))
	wf_visual_asset(vis, asset, charsmax(asset))
	new bool:bVisOk
	if (bModels)
		bVisOk = (vis[0] != 0 && wf_visual_is_model(vis) == 1 && containi(asset, "models/winterfest/present.mdl") >= 0) ? true : false
	else
		bVisOk = (vis[0] != 0 && wf_visual_is_model(vis) == 0 && containi(asset, "sprites/glow01.spr") >= 0) ? true : false
	report("visual-data", bVisOk,
		bModels ? "the rare present must draw models/winterfest/present.mdl while wf_allow_models is on"
		        : "the rare present must resolve to its stock-sprite fallback while models are gated")

	// The world, not just the config: with the gate on, a present is a func_wall
	// drawing the shipped model. With the gate off there must be none of those and
	// the props are env_sprites - the "presents are just shining lights" report,
	// asserted in both directions.
	new iModelProps = 0, iSpriteProps = 0
	new ent = -1
	while ((ent = engfunc(EngFunc_FindEntityByString, ent, "model", "models/winterfest/present.mdl")) > 0)
	{
		new szClass[32]
		pev(ent, pev_classname, szClass, charsmax(szClass))
		if (equali(szClass, "func_wall"))
			iModelProps++
	}
	ent = -1
	while ((ent = engfunc(EngFunc_FindEntityByString, ent, "classname", "env_sprite")) > 0)
	{
		new szModel[64]
		pev(ent, pev_model, szModel, charsmax(szModel))
		if (containi(szModel, "sprites/glow01.spr") >= 0)
			iSpriteProps++
	}
	report("present-world-prop",
		bModels ? (iModelProps > 0) : (iModelProps == 0 && iSpriteProps > 0),
		bModels ? "no func_wall present drawing models/winterfest/present.mdl is in the world"
		        : "with models gated there must be no model prop and the glows must still be there")

	// ---- 3. presents: granted once, opened once ---------------------------
	new c0 = wf_gift_count(bot)
	new q1 = wf_grant(bot, WF_REWARD_GIFT, 2, "wftest#gift-a")
	new q2 = wf_grant(bot, WF_REWARD_GIFT, 2, "wftest#gift-a")
	new c1 = wf_gift_count(bot)
	report("gift-once", (q1 == WF_GRANT_OK && q2 == WF_GRANT_DUPLICATE && c1 - c0 == 1) ? true : false,
		"the second grant of the same present must not add a present")

	// The present we just added is the last one in the list.
	new instance = wf_gift_instance(bot, c1 - 1)
	report("gift-instance", (instance > 0 && wf_gift_rarity(bot, instance) == 2) ? true : false,
		"the new present is not a rare one")

	// Opening the SAME present twice in the same tick. The count assertion allows
	// for a present inside a present (the [open] pool can roll one), so what is
	// proven here is: first open consumed the instance, second open was refused
	// by the claim ledger, and the bag did not grow from the second call.
	new before = wf_gift_count(bot)
	new p1 = wf_open_gift(bot, instance)
	new mid = wf_gift_count(bot)
	new p2 = wf_open_gift(bot, instance)
	new after = wf_gift_count(bot)
	new gone = (wf_gift_rarity(bot, instance) < 0) ? true : false
	report("open-once",
		(p1 == WF_OPEN_OK && p2 == WF_OPEN_NOTHING && gone && (before - mid) <= 1 && after == mid) ? true : false,
		"the second open of one present must be refused and must not change the bag")

	// A second, different present must still pay. Without this, "opens once"
	// would also pass if opening were broken altogether.
	new q3 = wf_grant(bot, WF_REWARD_GIFT, 0, "wftest#gift-b")
	new inst2 = wf_gift_instance(bot, wf_gift_count(bot) - 1)
	new p3 = wf_open_gift(bot, inst2)
	report("open-second-pays", (q3 == WF_GRANT_OK && inst2 > 0 && p3 == WF_OPEN_OK) ? true : false,
		"a different present must open")

	// ---- 4. advent: a strict one-day window -------------------------------
	// Day n is claimable on its date only; after that it is EXPIRED, not
	// discounted (owner decision 2026-11-22 §6.3, final). The Advent Pass
	// entitlement unlocks every day at once, and the claim keys stay the same.
	new today = wf_advent_today()
	if (today > 0)
	{
		new d1 = wf_advent_claim(bot, today)
		new d2 = wf_advent_claim(bot, today)
		report("advent-today",
			(d1 == WF_ADVENT_CLAIM_OK && d2 == WF_ADVENT_CLAIM_CLAIMED) ? true : false,
			"today's day must pay once and then answer 'claimed'")

		if (today > 1)
		{
			new e1 = wf_advent_state(bot, today - 1)
			new e2 = wf_advent_claim(bot, today - 1)
			report("advent-expired",
				(e1 == WF_ADVENT_EXPIRED && e2 == WF_ADVENT_CLAIM_EXPIRED) ? true : false,
				"yesterday must answer 'expired' - there is no half-value catch-up")
		}

		if (today < 24)
		{
			new l1 = wf_advent_state(bot, today + 1)
			new l2 = wf_advent_claim(bot, today + 1)
			report("advent-locked",
				(l1 == WF_ADVENT_LOCKED && l2 == WF_ADVENT_CLAIM_LOCKED) ? true : false,
				"tomorrow must answer 'locked'")
		}

		// The Advent Pass: one missed day becomes claimable, once.
		new target = (today > 1) ? today - 1 : 24
		new ent1 = wf_grant_entitlement(bot, WF_PRODUCT_ADVENT_PASS, "test", "wftest#ent-advent")
		new ent2 = wf_grant_entitlement(bot, WF_PRODUCT_ADVENT_PASS, "test", "wftest#ent-advent")
		new u1 = wf_advent_state(bot, target)
		new c1 = wf_advent_claim(bot, target)
		new c2 = wf_advent_claim(bot, target)
		report("advent-pass",
			(ent1 == WF_GRANT_OK && ent2 == WF_GRANT_DUPLICATE && u1 == WF_ADVENT_UNLOCKED
			 && c1 == WF_ADVENT_CLAIM_OK && c2 == WF_ADVENT_CLAIM_CLAIMED) ? true : false,
			"the Advent Pass must unlock a missed day, once, and the grant itself must be idempotent")
	}
	else
	{
		report("advent-today", false, "wf_advent_today() is 0 while the season is forced open")
	}

	// ---- 5. winter pass: free + premium -----------------------------------
	// A premium tier pays ONLY with the entitlement, the two tracks use separate
	// claim keys, and both are idempotent (owner decision §6.2, final).
	new x1 = wf_get_pass_xp(bot)
	new gx1 = wf_grant(bot, WF_REWARD_PASS_XP, 400, "wftest#xp-a")
	new x2 = wf_get_pass_xp(bot)
	new gx2 = wf_grant(bot, WF_REWARD_PASS_XP, 400, "wftest#xp-a")
	new x3 = wf_get_pass_xp(bot)
	report("pass-xp",
		(gx1 == WF_GRANT_OK && gx2 == WF_GRANT_DUPLICATE && x2 > x1 && x3 == x2) ? true : false,
		"pass XP must move once for one claim key")

	report("premium-locked",
		(wf_pass_premium_unlocked(bot) == 0 && wf_claim_pass_tier(bot, 1, true) == WF_GRANT_INVALID) ? true : false,
		"a premium tier must be refused while the entitlement is missing")

	// Buying the premium track back-pays every tier already reached: tier 1 pays
	// 150 GingerBread and tier 2 pays 2 spins (see [pass_premium]), so the grant
	// must move both counters. The explicit claim then answers "already paid",
	// which is the idempotency working, and the free key is untouched by it.
	new gb_pre = wf_get_gingerbread(bot)
	new spins_pre = wf_get_spins(bot)
	new bent1 = wf_grant_entitlement(bot, WF_PRODUCT_BP_PREMIUM, "test", "wftest#ent-premium")
	new bent2 = wf_grant_entitlement(bot, WF_PRODUCT_BP_PREMIUM, "test", "wftest#ent-premium")
	new prem1 = wf_claim_pass_tier(bot, 1, true)
	new prem2 = wf_claim_pass_tier(bot, 1, true)
	// The free claim above must NOT have been consumed by the premium one.
	new free3 = wf_claim_pass_tier(bot, 1, false)
	new gb_post = wf_get_gingerbread(bot)
	new spins_post = wf_get_spins(bot)
	report("premium-entitled",
		(bent1 == WF_GRANT_OK && bent2 == WF_GRANT_DUPLICATE && wf_pass_premium_unlocked(bot) == 1
		 && prem1 == WF_GRANT_DUPLICATE && prem2 == WF_GRANT_DUPLICATE && free3 == WF_GRANT_DUPLICATE
		 && gb_post - gb_pre >= 150 && spins_post - spins_pre >= 2) ? true : false,
		"the entitlement must pay the reached premium tiers once, and the two tracks must not share a key")

	report("entitlement-unknown",
		(wf_has_entitlement(bot, "no_such_product") == WF_ENT_UNKNOWN
		 && wf_grant_entitlement(bot, "no_such_product", "test", "wftest#ent-bad") == WF_GRANT_INVALID) ? true : false,
		"an unknown product id must be refused, not silently granted")

	report("pass-natives",
		(wf_get_pass_xp(bot) == wf_pass_xp(bot) && wf_get_pass_tier(bot) == wf_pass_tier(bot)) ? true : false,
		"wf_get_pass_xp/wf_get_pass_tier must agree with their aliases")

	server_print("[WF-TEST] sample bot=%d gb=%d spins=%d gifts=%d ornaments=%d tree=%d passxp=%d tier=%d premium=%d",
		bot, wf_get_gingerbread(bot), wf_get_spins(bot), wf_gift_count(bot), wf_ornament_count(bot),
		wf_tree_level(bot), wf_get_pass_xp(bot), wf_get_pass_tier(bot), wf_pass_premium_unlocked(bot))
}

report(const name[], bool:ok, const note[])
{
	if (ok)
	{
		g_iPass++
		server_print("[WF-TEST] PASS %s", name)
	}
	else
	{
		g_iFail++
		server_print("[WF-TEST] FAIL %s - %s", name, note)
	}
}

finish()
{
	g_bRan = true
	server_print("[WF-TEST] summary pass=%d fail=%d", g_iPass, g_iFail)
	server_print("[CS16TEST] tick")
}
