/**
 * Clean fixture for tools/lint-plugins.py --self-test.
 *
 * The correct form of every pattern in bad.sma: no finding may be reported here.
 */
#include <amxmodx>

public plugin_init()
{
    register_plugin("lint fixture clean", "1.0.0", "FreeNova")

    new id = 1
    new szBuf[64], szOut[96]

    // two buffers instead of self-aliasing formatex()
    copy(szBuf, charsmax(szBuf), "value")
    formatex(szOut, charsmax(szOut), "x%s", szBuf)

    // a literal format and a %s argument
    server_print("%s", szOut)

    // the real CS 1.6 classname
    give_item(id, "item_thighpack")
    give_item(id, "weapon_ak47")

    // the library this plugin registers below, and one AMXX provides
    if (!LibraryExists("fixture_lib", LibType_Library) && !LibraryExists("hamsandwich"))
        server_print("no libs")

    // a single stats key for the file
    new szQuery[192]
    formatex(szQuery, charsmax(szQuery),
        "SELECT 1 FROM player_stats WHERE player_id = %d AND server_id = 0", id)
}

public plugin_natives()
{
    register_library("fixture_lib")
}
