#include <amxmodx>
#include <amxmisc>
#include <ranksultimate>
#include "include/rsu.inc"

#define PLUGIN_NAME     "FREENova RSU Stats & Profile"
#define PLUGIN_VERSION  RSU_VERSION_STRING
#define PLUGIN_AUTHOR   RSU_AUTHOR_STRING

// ============================================================================
// Stats Viewer SHIM - intentionally slim, no commands of its own.
//
// The chat/stats surface has a single owner: rsu_core plugin_init registers
// say/say_team /top15, /profile and /rankstats, and the config-driven keys
// STATS_COMMANDS / STATSVIEWER_COMMANDS / TOP15_COMMANDS are marked retired
// in rank_system_ultimate.ini ("stats surface is /top15, /profile,
// /rankstats only").
//
// This file used to carry a second, UNREGISTERED copy of that surface
// (CmdProfile / CmdStatsMe / CmdRankStats / CmdStatsMenu + inspect menus).
// Nothing ever registered those publics to a say command, so they were dead
// code: no command pointed at them, and the live plugins.ini does not load
// rsu_stats either. Re-registering them here would have made both handlers
// fire on the same say line (double menus), so they were deleted instead of
// re-registered. The plugin keeps only register_plugin + the module
// registration so rsu_module_list / rsu_register_module keeps working if the
// shim is ever loaded again.
// ============================================================================

public plugin_init()
{
    register_plugin(PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

    rsu_register_module("Stats Viewer", PLUGIN_VERSION, PLUGIN_AUTHOR);
}
