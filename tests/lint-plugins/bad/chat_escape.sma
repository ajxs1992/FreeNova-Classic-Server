/**
 * Rule 8 fixture for tools/lint-plugins.py --self-test.
 *
 * Two escape styles, neither of them rendered by the surface it is sent to:
 * the GoldSrc MENU codes (\y \w \r \d) in chat, and the CHAT codes (^1..^4) in
 * HUD text and in a MOTD title. Never compiled into a server.
 */
#include <amxmodx>

public plugin_init()
{
    new id = 1

    // 8a. chat-escape: \d and \w are menu chrome; client_print_color prints them
    //     as the two characters backslash + letter.
    client_print_color(id, print_team_default, "^4[WF]^1 %s \d(dim)\w", "x")

    // 8b. chat-escape: HUD text renders no colour code at all (only ^n).
    show_hudmessage(id, "Lv %d  ^3gold^1 coins", 3)

    // 8c. chat-escape: a MOTD title is HTML, so the code shows raw in the frame.
    show_motd(id, "http://127.0.0.1:8080/m/p/0-0-1.htm", "^4FreeNova^1 Rules")
}
