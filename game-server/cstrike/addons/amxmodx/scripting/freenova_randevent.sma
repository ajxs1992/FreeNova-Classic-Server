/*
 * ============================================================================
 * FreeNova Random Events  (freenova_randevent)
 * ============================================================================
 * Fallback event driver: fires a random server event on a timer when nobody
 * else is driving one. NEVER fights the panel: at fire time it checks every
 * event cvar, and if a panel-driven (or schedule-driven) event is already
 * active it skips firing and reschedules a retry.
 *
 * OWNERSHIP (read-only here; this plugin only WRITES values, never registers
 * the cvars — set via get_cvar_pointer + set_pcvar_*, never register_cvar):
 *   fn_event_xp_mult    (float, 1.0 = off) - owned by freenova_sync
 *   fn_event_coins_mult (float, 1.0 = off) - owned by freenova_sync
 *   fn_double_xp        (int, 0 = off)      - owned by freenova_panel
 *   fn_happy_hour       (float, 1.0 = off)  - owned by freenova_progression
 *
 * SKIP-WHEN-ACTIVE (checked at every fire; float compare tolerance 0.001):
 *   fn_event_xp_mult != 1.0 OR fn_event_coins_mult != 1.0 OR
 *   fn_double_xp != 0 OR fn_happy_hour != 1.0  -> event active, skip firing,
 *   log only (no chat spam), retry in FN_RE_RETRY_MIN minutes.
 *
 * EVENT FLAVORS (random pick among AVAILABLE flavors only — a flavor whose
 * owner cvar does not exist, e.g. owner plugin absent, is excluded):
 *   0 xp_mult    -> fn_event_xp_mult    = 1.5..3.0 (random, 0.1 steps)
 *   1 coins_mult -> fn_event_coins_mult = 1.5..3.0 (random, 0.1 steps)
 *                   (magnitudes inside sync ClampEventMult 1.0..5.0 range)
 *   2 double_xp  -> fn_double_xp        = 1 (panel 1/0 int contract)
 *   3 happy_hour -> fn_happy_hour       = 2.0
 * Prior values are stored at fire and restored at revert (normally 1.0/1.0/0/1.0).
 *
 * HAPPY-HOUR NOTE: freenova_progression TaskHappyHour rewrites fn_happy_hour
 * every 30s from its schedule. During a happy_hour event this plugin
 * re-asserts the event value every 20s until revert, then restores the prior
 * value so the schedule resumes cleanly. This re-assert loop runs ONLY while
 * OUR event is active; scheduled/progression happy hours are detected by the
 * skip check and never overridden at fire time.
 *
 * DURATION: fn_re_duration minutes per event, then a task reverts values and
 * announces the end. Chat announce (client_print_color to all) + HUD announce
 * (set_hudmessage channel -1 = auto-select, 5s hold) on start AND end.
 *
 * Cvars (fn_re_*, owned here):
 *   fn_re_enabled   1  - master switch
 *   fn_re_min       20 - minutes between events (random window low end)
 *   fn_re_max       45 - minutes between events (random window high end)
 *   fn_re_duration  10 - event length in minutes before revert
 * ============================================================================
 */

#include <amxmodx>
#include <amxmisc>

#define PLUGIN  "FreeNova Random Events"
#define VERSION "1.0.0"
#define AUTHOR  "FreeNova"

#define TASK_FIRE   63001
#define TASK_END    63002
#define TASK_ASSERT 63003

#define FN_RE_RETRY_MIN 5       // retry delay after a skip (minutes)
#define FN_RE_ASSERT_SEC 20.0   // happy-hour re-assert period (seconds)
#define FLOAT_TOL 0.001

#define FLAVOR_XP     0
#define FLAVOR_COINS  1
#define FLAVOR_DOUBLE 2
#define FLAVOR_HAPPY  3
#define FLAVOR_COUNT  4

new g_pCvarEnabled
new g_pCvarMin
new g_pCvarMax
new g_pCvarDuration

new g_iActiveFlavor = -1   // -1 = idle, else FLAVOR_*
new g_iSavedDouble = 0
new Float:g_fSavedXp = 1.0
new Float:g_fSavedCoins = 1.0
new Float:g_fSavedHappy = 1.0
new Float:g_fEventValue = 1.0

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    g_pCvarEnabled  = register_cvar("fn_re_enabled", "1")
    g_pCvarMin      = register_cvar("fn_re_min", "20")
    g_pCvarMax      = register_cvar("fn_re_max", "45")
    g_pCvarDuration = register_cvar("fn_re_duration", "10")
}

public plugin_cfg()
{
    // Per-map state: never inherit an active flavor from an in-place reload.
    g_iActiveFlavor = -1
    ScheduleNext()
}

// --- scheduling -------------------------------------------------------------

ScheduleNext()
{
    remove_task(TASK_FIRE)

    new iMin = get_pcvar_num(g_pCvarMin)
    new iMax = get_pcvar_num(g_pCvarMax)
    if (iMin < 1)
        iMin = 1
    if (iMax < iMin)
        iMax = iMin

    new iWait = random_num(iMin, iMax)
    set_task(float(iWait * 60), "Task_Fire", TASK_FIRE)
    log_amx("[FreeNova][RandEvent] next roll in %d minutes", iWait)
}

ScheduleRetry()
{
    remove_task(TASK_FIRE)
    set_task(float(FN_RE_RETRY_MIN * 60), "Task_Fire", TASK_FIRE)
    log_amx("[FreeNova][RandEvent] skipped (event already active) - retry in %d minutes", FN_RE_RETRY_MIN)
}

// --- owner cvar pointers (resolved lazily: owners may load after us) --------

ResolvePtr(const szName[])
{
    return get_cvar_pointer(szName)
}

// --- skip-when-active -------------------------------------------------------

bool:AnyEventActive()
{
    new pXp = ResolvePtr("fn_event_xp_mult")
    new pCoins = ResolvePtr("fn_event_coins_mult")
    new pDouble = ResolvePtr("fn_double_xp")
    new pHappy = ResolvePtr("fn_happy_hour")

    if (pXp && floatabs(get_pcvar_float(pXp) - 1.0) > FLOAT_TOL)
        return true
    if (pCoins && floatabs(get_pcvar_float(pCoins) - 1.0) > FLOAT_TOL)
        return true
    if (pDouble && get_pcvar_num(pDouble) != 0)
        return true
    if (pHappy && floatabs(get_pcvar_float(pHappy) - 1.0) > FLOAT_TOL)
        return true
    return false
}

// --- fire -------------------------------------------------------------------

public Task_Fire()
{
    if (!get_pcvar_num(g_pCvarEnabled))
    {
        ScheduleNext()
        return
    }

    // Fallback only: never fire while a panel/schedule event is active.
    if (AnyEventActive())
    {
        ScheduleRetry()
        return
    }

    // Pick among AVAILABLE flavors (owner cvar must exist right now).
    new iAvail[FLAVOR_COUNT], iAvailNum
    if (ResolvePtr("fn_event_xp_mult"))
        iAvail[iAvailNum++] = FLAVOR_XP
    if (ResolvePtr("fn_event_coins_mult"))
        iAvail[iAvailNum++] = FLAVOR_COINS
    if (ResolvePtr("fn_double_xp"))
        iAvail[iAvailNum++] = FLAVOR_DOUBLE
    if (ResolvePtr("fn_happy_hour"))
        iAvail[iAvailNum++] = FLAVOR_HAPPY

    if (!iAvailNum)
    {
        log_amx("[FreeNova][RandEvent] no owner cvars present - retry later")
        ScheduleRetry()
        return
    }

    new iFlavor = iAvail[random_num(0, iAvailNum - 1)]

    // Snapshot priors for the revert path.
    new pXp = ResolvePtr("fn_event_xp_mult")
    new pCoins = ResolvePtr("fn_event_coins_mult")
    new pDouble = ResolvePtr("fn_double_xp")
    new pHappy = ResolvePtr("fn_happy_hour")
    g_fSavedXp = pXp ? get_pcvar_float(pXp) : 1.0
    g_fSavedCoins = pCoins ? get_pcvar_float(pCoins) : 1.0
    g_iSavedDouble = pDouble ? get_pcvar_num(pDouble) : 0
    g_fSavedHappy = pHappy ? get_pcvar_float(pHappy) : 1.0

    new szDesc[64]
    if (iFlavor == FLAVOR_XP)
    {
        g_fEventValue = float(random_num(15, 30)) / 10.0   // 1.5..3.0
        set_pcvar_float(pXp, g_fEventValue)
        formatex(szDesc, charsmax(szDesc), "%.1fx XP", g_fEventValue)
    }
    else if (iFlavor == FLAVOR_COINS)
    {
        g_fEventValue = float(random_num(15, 30)) / 10.0   // 1.5..3.0
        set_pcvar_float(pCoins, g_fEventValue)
        formatex(szDesc, charsmax(szDesc), "%.1fx coins", g_fEventValue)
    }
    else if (iFlavor == FLAVOR_DOUBLE)
    {
        set_pcvar_num(pDouble, 1)
        copy(szDesc, charsmax(szDesc), "Double XP")
    }
    else
    {
        g_fEventValue = 2.0
        set_pcvar_float(pHappy, g_fEventValue)
        copy(szDesc, charsmax(szDesc), "Happy Hour (2.0x)")
        // See HAPPY-HOUR NOTE: re-assert against the 30s schedule tick.
        set_task(FN_RE_ASSERT_SEC, "Task_AssertHappy", TASK_ASSERT)
    }

    g_iActiveFlavor = iFlavor

    new iDur = get_pcvar_num(g_pCvarDuration)
    if (iDur < 1)
        iDur = 1

    Announce("Random event started: %s for %d minute%s!", szDesc, iDur, iDur == 1 ? "" : "s")
    log_amx("[FreeNova][RandEvent] FIRED flavor=%d (%s) duration=%d min", iFlavor, szDesc, iDur)

    remove_task(TASK_END)
    set_task(float(iDur * 60), "Task_End", TASK_END)
}

public Task_AssertHappy()
{
    // Re-assert loop: runs only while OUR happy_hour event is active.
    if (g_iActiveFlavor != FLAVOR_HAPPY)
        return

    new pHappy = ResolvePtr("fn_happy_hour")
    if (pHappy)
        set_pcvar_float(pHappy, g_fEventValue)

    set_task(FN_RE_ASSERT_SEC, "Task_AssertHappy", TASK_ASSERT)
}

// --- revert -----------------------------------------------------------------

public Task_End()
{
    remove_task(TASK_ASSERT)
    RevertEvent()

    log_amx("[FreeNova][RandEvent] ENDED flavor=%d, values restored", g_iActiveFlavor)
    g_iActiveFlavor = -1

    Announce("Random event ended. Thanks for playing!")
    ScheduleNext()
}

// Restores the one owner cvar this event changed, from the value snapshotted at
// fire time. Shared by Task_End() and plugin_end().
RevertEvent()
{
    if (g_iActiveFlavor == FLAVOR_XP)
    {
        new pXp = ResolvePtr("fn_event_xp_mult")
        if (pXp)
            set_pcvar_float(pXp, g_fSavedXp)
    }
    else if (g_iActiveFlavor == FLAVOR_COINS)
    {
        new pCoins = ResolvePtr("fn_event_coins_mult")
        if (pCoins)
            set_pcvar_float(pCoins, g_fSavedCoins)
    }
    else if (g_iActiveFlavor == FLAVOR_DOUBLE)
    {
        new pDouble = ResolvePtr("fn_double_xp")
        if (pDouble)
            set_pcvar_num(pDouble, g_iSavedDouble)
    }
    else if (g_iActiveFlavor == FLAVOR_HAPPY)
    {
        new pHappy = ResolvePtr("fn_happy_hour")
        if (pHappy)
            set_pcvar_float(pHappy, g_fSavedHappy)
    }
}

// REVIEW.md §5.2: g_iActiveFlavor is per-map RAM and dies with the map, the
// owner cvar it boosted does not. An event that fired just before a map change
// therefore left fn_event_xp_mult (or fn_double_xp / fn_happy_hour) boosted for
// ever: AnyEventActive() stayed true, Task_Fire() retried for ever and Task_End()
// could never run. Restore on unload, exactly as Task_End() does.
public plugin_end()
{
    remove_task(TASK_FIRE)
    remove_task(TASK_END)
    remove_task(TASK_ASSERT)

    if (g_iActiveFlavor == -1)
        return

    RevertEvent()
    log_amx("[FreeNova][RandEvent] unloaded mid-event: flavor=%d restored", g_iActiveFlavor)
    g_iActiveFlavor = -1
}

// --- announce (chat + HUD) --------------------------------------------------

Announce(const szFmt[], any:...)
{
    new szMsg[192]
    vformat(szMsg, charsmax(szMsg), szFmt, 2)

    // Chat to everyone (0 = all).
    client_print_color(0, print_team_default, "^4[FreeNova]^1 %s", szMsg)

    // HUD flash: channel -1 = auto-select (transient 5s hold, never parked).
    set_hudmessage(255, 220, 0, -1.0, 0.30, 0, 1.0, 5.0, 0.1, 0.2, -1)
    show_hudmessage(0, "[FreeNova]^n%s", szMsg)
}
