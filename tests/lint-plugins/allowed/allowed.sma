/**
 * Acknowledgement fixture for tools/lint-plugins.py --self-test.
 *
 * The same bugs as bad.sma, each acknowledged with `lint:allow <rule>` and a
 * reason. None of them may fail the run: that is the mechanism a real operator
 * uses when a hit is safe by construction.
 */
#include <amxmodx>

public plugin_init()
{
    register_plugin("lint fixture allowed", "1.0.0", "FreeNova")

    new id = 1
    new szBuf[64]

    copy(szBuf, charsmax(szBuf), "value")
    // lint:allow format-alias - fixture: acknowledged on purpose
    formatex(szBuf, charsmax(szBuf), "x%s", szBuf)

    // lint:allow format-spec - fixture: acknowledged on purpose
    server_print("%N", 1)

    // lint:allow give-item - fixture: acknowledged on purpose
    give_item(id, "item_defuser")

    new szMsg[64]
    copy(szMsg, charsmax(szMsg), "hello")
    // lint:allow format-var - fixture: acknowledged on purpose
    client_print(id, print_chat, szMsg)

    // lint:allow library-missing - fixture: acknowledged on purpose
    if (LibraryExists("no_such_library", LibType_Library))
        server_print("unreachable")
}
