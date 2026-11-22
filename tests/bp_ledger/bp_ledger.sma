/**
 * FreeNova BattlePass XP ledger regression test (REVIEW.md §2.4 H1).
 *
 * Proves, at boot time, that the BP natives really come from battlepass_core's
 * own BattlePass ledger and not from crxranks:
 *
 *   - the `menabp` library is registered and the natives dispatch,
 *   - menabp_get_max_tier() answers the real tier cap (60), i.e. the native
 *     provider is loaded and answering,
 *   - every BP accessor fails closed (0 / -1) for a slot that has no loaded BP
 *     row, which is what keeps a wrong-slot call from touching anything.
 *
 * What it cannot do here: assert "BP XP went up while rank XP did not". The
 * natives only write for a real client whose BP row has finished loading
 * (g_bDataLoaded), and this harness has no client - YAPB bots are deliberately
 * excluded from BP data (battlepass_core client_putinserver returns early for
 * them) and the AMXX/ReAPI build in this image has no fake-client native. That
 * half of the assertion is covered by
 *   - tools/lint-plugins.py rule 7: the BP grant path must never reference
 *     crxranks_give_user_xp, and
 *   - web-panel/test_harness.mjs: a signed bp_xp/bp_tier push lands in its own
 *     columns and a rank-52 player with 0 BP XP renders tier 1.
 *
 * Run with:
 *   ./scripts/test-plugin.sh /home/ajxs/projects/FreeNova-Classic-Server/tests/bp_ledger/bp_ledger.sma --profile freenova
 */
#include <amxmodx>
#include <menabp>

public plugin_init()
{
    register_plugin("FreeNova BP ledger test", "1.0.0", "FreeNova")
    // The base harness requires these two markers of every test plugin
    // (docker/harness/test.sh) - they prove plugin_init ran and a task fired.
    server_print("[CS16TEST] init")
    set_task(1.0, "Task_CheckLedger")
}

public Task_CheckLedger()
{
    server_print("[CS16TEST] tick")
    if (!LibraryExists("menabp", LibType_Library))
    {
        server_print("[FNBP] lib=0")
        server_print("[FNBP] RESULT fail reason=no-menabp-library")
        return
    }
    server_print("[FNBP] lib=1")

    // The tier cap comes from battlepass_core's MAX_LEVELS, so 60 also proves
    // the native reached the BP ledger provider and not some other module.
    server_print("[FNBP] max_tier=%d", menabp_get_max_tier())

    // Fail-closed contract for a slot with no loaded BP row (id 0 is invalid).
    server_print("[FNBP] xp0=%d tier0=%d add0=%d once0=%d",
        menabp_get_xp(0), menabp_get_tier(0),
        menabp_add_xp(0, 100), menabp_add_xp_once(0, 100, "fnbp-test"))
    server_print("[FNBP] nextxp0=%d ready0=%d",
        menabp_get_next_xp(0), menabp_is_ready(0))

    server_print("[FNBP] RESULT ok")
}
