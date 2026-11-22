/**
 * Rule 7 fixture for tools/lint-plugins.py --self-test.
 *
 * The file name matters: rule 7 only police the BattlePass provider, whose XP
 * grant path must never move rank XP (REVIEW.md §9d).
 */
#include <amxmodx>

BpAddXp(id, amount)
{
    crxranks_give_user_xp(id, amount, "", CRXRANKS_XPS_PLUGIN)
    return amount
}

public native_add_bp_xp(plugin, params)
{
    new id = get_param(1)
    new amount = get_param(2)
    return BpAddXp(id, amount)
}
