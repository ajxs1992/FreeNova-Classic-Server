/**
 * Rule fixtures for tools/lint-plugins.py --self-test.
 *
 * Every finding in this file is deliberate: one instance of each bug class the
 * tool knows. It is never compiled into a server (it lives under tests/, not in
 * scripting/, and its natives do not resolve on purpose).
 */
#include <amxmodx>

public plugin_init()
{
    register_plugin("lint fixture", "1.0.0", "FreeNova")

    new id = 1
    new szBuf[64]

    // 1. format-alias: formatex() writes in place, so the %s source is the
    //    destination that has already been overwritten.
    copy(szBuf, charsmax(szBuf), "value")
    formatex(szBuf, charsmax(szBuf), "x%s", szBuf)

    // 2. format-spec: %N is a SourceMod specifier; the AMXX formatter raises a
    //    run time error on it.
    server_print("%N", 1)

    // 3. give-item: item_defuser has no CS 1.6 entity class (item_thighpack does).
    give_item(id, "item_defuser")

    // 4. format-var: a buffer used as the format string.
    new szMsg[64]
    copy(szMsg, charsmax(szMsg), "hello %")
    client_print(id, print_chat, szMsg)

    // 5. library-missing: nothing registers "no_such_library".
    if (LibraryExists("no_such_library", LibType_Library))
        server_print("unreachable")

    // 6. sql-serverid: the same file keys one query on a value and another on 0.
    new szQuery[192]
    formatex(szQuery, charsmax(szQuery),
        "SELECT 1 FROM player_stats WHERE player_id = %d AND server_id = %d", id, id)
    formatex(szQuery, charsmax(szQuery),
        "SELECT 1 FROM player_stats WHERE player_id = %d AND server_id = 0", id)
}
