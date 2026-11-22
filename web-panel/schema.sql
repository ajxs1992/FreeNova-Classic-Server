-- FreeNova Web Panel schema v2 (D1 / SQLite)
-- Single source of web truth. The game server pushes signed snapshots
-- (POST /api/v1/server/stats); pages are read-only; mutations flow back
-- to the game as queued actions in the push response.

-- ============================================================ players
CREATE TABLE IF NOT EXISTS players (
    steamid            TEXT PRIMARY KEY,
    name               TEXT NOT NULL DEFAULT '',
    -- progression (RSU/CRX authoritative)
    xp                 INTEGER NOT NULL DEFAULT 0,
    level              INTEGER NOT NULL DEFAULT 1,
    rank_id            INTEGER NOT NULL DEFAULT 1,
    prestige           INTEGER NOT NULL DEFAULT 0,
    -- combat
    kills              INTEGER NOT NULL DEFAULT 0,
    deaths             INTEGER NOT NULL DEFAULT 0,
    assists            INTEGER NOT NULL DEFAULT 0,
    headshots          INTEGER NOT NULL DEFAULT 0,
    damage             INTEGER NOT NULL DEFAULT 0,
    shots              INTEGER NOT NULL DEFAULT 0,
    hits               INTEGER NOT NULL DEFAULT 0,
    mvps               INTEGER NOT NULL DEFAULT 0,
    wins               INTEGER NOT NULL DEFAULT 0,
    losses             INTEGER NOT NULL DEFAULT 0,
    playtime_minutes   INTEGER NOT NULL DEFAULT 0,
    -- derived once game-side; identical on every surface
    rating_x100        INTEGER NOT NULL DEFAULT 0,
    -- economy / status
    vip_tier           INTEGER NOT NULL DEFAULT 0,
    vip_remaining      INTEGER NOT NULL DEFAULT 0, -- seconds left; 0 = none, -1 = permanent
    coins              INTEGER NOT NULL DEFAULT 0,
    -- battlepass daily missions (real per-day vault state)
    bp_daily_kills     INTEGER NOT NULL DEFAULT 0,
    bp_daily_hs        INTEGER NOT NULL DEFAULT 0,
    bp_daily_plants    INTEGER NOT NULL DEFAULT 0,
    bp_daily_defuses   INTEGER NOT NULL DEFAULT 0,
    bp_daily_wins      INTEGER NOT NULL DEFAULT 0,
    bp_daily_streak    INTEGER NOT NULL DEFAULT 0,
    bp_daily_damage    INTEGER NOT NULL DEFAULT 0,
    bp_daily_survives  INTEGER NOT NULL DEFAULT 0,
    bp_daily_complete  INTEGER NOT NULL DEFAULT 0,
    -- battlepass weekly missions
    bp_weekly_kills    INTEGER NOT NULL DEFAULT 0,
    bp_weekly_hs       INTEGER NOT NULL DEFAULT 0,
    bp_weekly_plants   INTEGER NOT NULL DEFAULT 0,
    bp_weekly_wins     INTEGER NOT NULL DEFAULT 0,
    bp_weekly_complete INTEGER NOT NULL DEFAULT 0,
    -- competitive (tournament) season + career
    comp_season        TEXT NOT NULL DEFAULT '',
    comp_points        INTEGER NOT NULL DEFAULT 0,
    comp_lifetime      INTEGER NOT NULL DEFAULT 0,
    comp_kills         INTEGER NOT NULL DEFAULT 0,
    comp_hs            INTEGER NOT NULL DEFAULT 0,
    comp_wins          INTEGER NOT NULL DEFAULT 0,
    comp_mvp           INTEGER NOT NULL DEFAULT 0,
    comp_msn_k         INTEGER NOT NULL DEFAULT 0,
    comp_msn_h         INTEGER NOT NULL DEFAULT 0,
    comp_msn_w         INTEGER NOT NULL DEFAULT 0,
    comp_msn_m         INTEGER NOT NULL DEFAULT 0,
    comp_msn_done      INTEGER NOT NULL DEFAULT 0,
    -- equipped cosmetics (real equipped state from freenova_cosmetics)
    eq_spawn           INTEGER NOT NULL DEFAULT 0,
    eq_title           INTEGER NOT NULL DEFAULT 0,
    eq_death           INTEGER NOT NULL DEFAULT 0,
    eq_color           INTEGER NOT NULL DEFAULT 0,
    custom_tag         TEXT NOT NULL DEFAULT '',
    -- equipped player model ('' = default team model)
    eq_model           TEXT NOT NULL DEFAULT '',
    -- battlepass boost cursors (from bp_boosts snapshot)
    bp_hp              INTEGER NOT NULL DEFAULT 0,
    bp_armor           INTEGER NOT NULL DEFAULT 0,
    bp_jumps           INTEGER NOT NULL DEFAULT 0,
    bp_sniper          INTEGER NOT NULL DEFAULT 0,
    bp_laststand       INTEGER NOT NULL DEFAULT 0,
    bp_chute           INTEGER NOT NULL DEFAULT 0,
    bp_premium         INTEGER NOT NULL DEFAULT 0,
    bp_milestone       INTEGER NOT NULL DEFAULT 0,
    -- BattlePass XP + tier ledger (REVIEW.md §2.4 H1). Pushed by the game from
    -- battlepass_core's `bpxp` vault key and tiered by bp_track.bpTierFromXp.
    -- Rank xp/level above never derives these.
    bp_xp              INTEGER NOT NULL DEFAULT 0,
    bp_tier            INTEGER NOT NULL DEFAULT 0,
    -- battlepass season + per-season premium entitlement (additive 2026-10-10;
    -- game snapshot upsert never writes these; store/staff grant path only)
    bp_season          TEXT NOT NULL DEFAULT '1',
    bp_premium_season  TEXT NOT NULL DEFAULT '',
    bp_ent_lane        INTEGER NOT NULL DEFAULT 0,
    bp_ent_order       TEXT NOT NULL DEFAULT '',
    bp_ent_at          INTEGER NOT NULL DEFAULT 0,
    -- optional lifetime achievement snapshot (nullable; game may omit)
    ach_unlocked       INTEGER,
    ach_kills          INTEGER,
    ach_hs             INTEGER,
    ach_plants         INTEGER,
    ach_defuses        INTEGER,
    ach_wins           INTEGER,
    ach_revives        INTEGER,
    ach_streak         INTEGER,
    rerolls_left       INTEGER,
    msn_st_d           INTEGER,
    msn_st_b           INTEGER,
    msn_st_w           INTEGER,
    msn_st_v           INTEGER,
    msn_vip_p          INTEGER,
    msn_tg             TEXT,
    server_id          TEXT NOT NULL DEFAULT '',
    cc               TEXT NOT NULL DEFAULT '',
    last_seen          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_players_xp     ON players (xp DESC);
CREATE INDEX IF NOT EXISTS idx_players_kills  ON players (kills DESC);
CREATE INDEX IF NOT EXISTS idx_players_comp   ON players (comp_points DESC);
CREATE INDEX IF NOT EXISTS idx_players_rating ON players (rating_x100 DESC);
CREATE INDEX IF NOT EXISTS idx_players_seen   ON players (last_seen DESC);

-- ============================================================ per-weapon stats
CREATE TABLE IF NOT EXISTS player_weapons (
    steamid  TEXT NOT NULL,
    slot     INTEGER NOT NULL,            -- freenova_wpn.inc slot (0-22)
    kills    INTEGER NOT NULL DEFAULT 0,
    hs       INTEGER NOT NULL DEFAULT 0,
    damage   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, slot)
);
CREATE INDEX IF NOT EXISTS idx_pw_kills ON player_weapons (slot, kills DESC);

-- ============================================================ owned weapon skins
CREATE TABLE IF NOT EXISTS player_skins (
    steamid   TEXT NOT NULL,
    grp       TEXT NOT NULL,              -- ak47 | m4a1 | deagle | awp | knife
    skin      INTEGER NOT NULL,           -- index inside group (0 = default)
    equipped  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, grp, skin)
);

-- ============================================================ owned player models
CREATE TABLE IF NOT EXISTS player_models (
    steamid   TEXT NOT NULL,
    model     TEXT NOT NULL,              -- model key (catalog id or forced name)
    equipped  INTEGER NOT NULL DEFAULT 0,
    forced    INTEGER NOT NULL DEFAULT 0, -- 1 = owner assignment via player_models.ini
    PRIMARY KEY (steamid, model)
);

-- Skill stages pushed by the game (skills{<id>: <stage>}); read by the
-- store so UPGRADE/MAX labels reflect owned stages instead of PURCHASE.
CREATE TABLE IF NOT EXISTS player_skills (
    steamid   TEXT NOT NULL,
    skill     TEXT NOT NULL,              -- skill key, e.g. multi_jump
    stage     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, skill)
);

-- ============================================================ catalogs pushed from the game
CREATE TABLE IF NOT EXISTS catalog (
    key        TEXT PRIMARY KEY,          -- skins | models | cosmetics | reward_track
    version    INTEGER NOT NULL DEFAULT 0,
    json       TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
);

-- ============================================================ web -> game action queue
-- Every mutation requested from a panel lands here; the game consumes it in
-- the next push response, validates it against authoritative state, applies
-- it, and reports the result in the following push.
CREATE TABLE IF NOT EXISTS actions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid     TEXT NOT NULL,
    type        TEXT NOT NULL,            -- buy_skin|equip_skin|buy_model|equip_model|set_tag|unequip_tag|unequip_model|claim_bp|buy_skill|claim_tournament|claim_mission|reroll_mission|claim_mission_all|claim_event|srv_event_apply|srv_event_clear|srv_event_reward|srv_map
    arg         TEXT NOT NULL DEFAULT '', -- type-specific, e.g. "ak47:3" or tag text
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|done|failed|expired
    attempts    INTEGER NOT NULL DEFAULT 0,
    result      TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT 0,
    closed_at   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_actions_pending ON actions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_actions_player  ON actions (steamid, created_at DESC);

-- ============================================================ tournament season history
CREATE TABLE IF NOT EXISTS comp_history (
    steamid   TEXT NOT NULL,
    season    TEXT NOT NULL,              -- "YYYY-MM"
    points    INTEGER NOT NULL DEFAULT 0,
    kills     INTEGER NOT NULL DEFAULT 0,
    hs        INTEGER NOT NULL DEFAULT 0,
    wins      INTEGER NOT NULL DEFAULT 0,
    mvp       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, season)
);

-- ============================================================ server meta
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,               -- last_push | server_online | server_name ...
    value TEXT NOT NULL DEFAULT ''
);

-- Profile display prefs (featured medals). Ownership is re-checked from live stats.
CREATE TABLE IF NOT EXISTS player_profile (
    steamid    TEXT PRIMARY KEY,
    featured   TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
);

-- Per-map career totals (replica of AMXX rsu_player_maps). Filled by sync when present.
CREATE TABLE IF NOT EXISTS player_maps (
    steamid      TEXT NOT NULL,
    map_name     TEXT NOT NULL,
    matches      INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    losses       INTEGER NOT NULL DEFAULT 0,
    kills        INTEGER NOT NULL DEFAULT 0,
    deaths       INTEGER NOT NULL DEFAULT 0,
    assists      INTEGER NOT NULL DEFAULT 0,
    headshots    INTEGER NOT NULL DEFAULT 0,
    damage       INTEGER NOT NULL DEFAULT 0,
    last_played  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, map_name)
);
CREATE INDEX IF NOT EXISTS idx_pm_kills ON player_maps (map_name, kills DESC);

-- First-time AP unlock dates (replica of AMXX rsu_ap_unlocks).
CREATE TABLE IF NOT EXISTS ap_unlocks (
    steamid    TEXT NOT NULL,
    code       TEXT NOT NULL,
    ap         INTEGER NOT NULL DEFAULT 0,
    earned_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, code)
);

-- ============================================================ admin control center + event scheduler
-- Staff auth lives in admin.js (session cookie). pin_hash is never logged.
-- Scheduler (sync.js) activates/completes rows and queues srv_* actions.
CREATE TABLE IF NOT EXISTS staff (
    steamid     TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    pin_hash    TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT 'admin',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT 0,
    last_login  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_staff_steamid ON staff (steamid);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token       TEXT PRIMARY KEY,
    steamid     TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT 0,
    expires_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid     TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit (created_at DESC);

CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT 'event',
    status          TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled|active|completed|error
    start_at        INTEGER NOT NULL DEFAULT 0,
    end_at          INTEGER NOT NULL DEFAULT 0,
    xp_mult         REAL NOT NULL DEFAULT 1,
    coins_mult      REAL NOT NULL DEFAULT 1,
    conflict_group  TEXT NOT NULL DEFAULT '',
    error_msg       TEXT NOT NULL DEFAULT '',
    created_by      TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL DEFAULT 0,
    -- events data contract (read by pages.js with `row.x || fallback`)
    metric          TEXT DEFAULT 'none',
    target          INTEGER DEFAULT 0,
    scope           TEXT DEFAULT 'global',
    reward          TEXT DEFAULT '',
    -- settlement contract: structured first-place prize + eligibility floor
    reward_coins    INTEGER DEFAULT 0,
    reward_viptier  INTEGER DEFAULT 0,
    reward_vipdays  INTEGER DEFAULT 0,
    min_score       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_status_start ON events (status, start_at);

-- Per-event window baselines: lifetime counter value at first sight inside
-- the window. Progress = current - baseline. Never credit pre-event activity.
CREATE TABLE IF NOT EXISTS event_baselines (
    event_id        INTEGER NOT NULL,
    steamid         TEXT NOT NULL,
    metric          TEXT NOT NULL,
    baseline        INTEGER NOT NULL DEFAULT 0,
    taken_at        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, steamid, metric)
);
-- Finalized winners. Idempotent finalize: INSERT OR IGNORE on (event_id, placement).
CREATE TABLE IF NOT EXISTS event_winners (
    event_id        INTEGER NOT NULL,
    placement       INTEGER NOT NULL,
    steamid         TEXT NOT NULL,
    score           INTEGER NOT NULL DEFAULT 0,
    reward_coins    INTEGER NOT NULL DEFAULT 0,
    reward_viptier  INTEGER NOT NULL DEFAULT 0,
    reward_vipdays  INTEGER NOT NULL DEFAULT 0,
    issued_at       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, placement)
);
CREATE INDEX IF NOT EXISTS idx_winners_event ON event_winners (event_id);
-- Append-only audit for settlement, resets, reviews.
CREATE TABLE IF NOT EXISTS event_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              INTEGER NOT NULL DEFAULT 0,
    actor           TEXT NOT NULL DEFAULT '',
    action          TEXT NOT NULL DEFAULT '',
    entity          TEXT NOT NULL DEFAULT '',
    meta            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS event_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        INTEGER NOT NULL UNIQUE,
    title           TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT '',
    xp_mult         REAL NOT NULL DEFAULT 1,
    coins_mult      REAL NOT NULL DEFAULT 1,
    start_at        INTEGER NOT NULL DEFAULT 0,
    end_at          INTEGER NOT NULL DEFAULT 0,
    completed_at    INTEGER NOT NULL DEFAULT 0
);

-- ============================================================ weekly / monthly boards
-- Additive 2026-11-22 (MOTD v2 + public API). Safe on the live replica: every
-- statement is IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so booting the
-- runner over an existing database (server_local.mjs execs this file) only
-- creates what is missing and never rewrites a live row.
-- src/boards.js repeats the same DDL lazily, so a deployment that never execs
-- this file still gets the tables the first time a board is read.
--
-- board_marks: per-player, per-period baseline of a lifetime counter. A period
-- value is max(0, last_value - base) — never an invented number (boards.js).
CREATE TABLE IF NOT EXISTS board_marks (
    period      TEXT NOT NULL,              -- week | month
    period_key  TEXT NOT NULL,              -- 2026-W47 | 2026-11
    steamid     TEXT NOT NULL,
    metric      TEXT NOT NULL DEFAULT 'xp',
    base        INTEGER NOT NULL DEFAULT 0,
    last_value  INTEGER NOT NULL DEFAULT 0,
    first_seen  INTEGER NOT NULL DEFAULT 0,
    seen_at     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (period, period_key, steamid, metric)
);
CREATE INDEX IF NOT EXISTS idx_board_marks_key ON board_marks (period, period_key, metric, last_value DESC);

-- board_history: the settled top N of a finished period ("last week's winner").
CREATE TABLE IF NOT EXISTS board_history (
    period      TEXT NOT NULL,
    period_key  TEXT NOT NULL,
    metric      TEXT NOT NULL DEFAULT 'xp',
    rank        INTEGER NOT NULL,
    steamid     TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    value       INTEGER NOT NULL DEFAULT 0,
    settled_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (period, period_key, metric, rank)
);
CREATE INDEX IF NOT EXISTS idx_board_history_key ON board_history (period, period_key, metric, rank);

-- badges: TEXT ONLY (no client content, no images, no models). Awarded by the
-- rollover in boards.js: weekly #1, monthly #1, weekly top 3, top 3 x3 weeks.
CREATE TABLE IF NOT EXISTS badges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid     TEXT NOT NULL,
    kind        TEXT NOT NULL,              -- weekly_champion | monthly_champion | weekly_top3 | weekly_streak3
    period      TEXT NOT NULL DEFAULT '',   -- the period key the badge was won in
    label       TEXT NOT NULL DEFAULT '',
    awarded_at  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (steamid, kind, period)
);
CREATE INDEX IF NOT EXISTS idx_badges_player ON badges (steamid);

-- events: the player-facing blurb the panel schedule publishes
-- (/api/public/events, /m/e/). ALTER is not idempotent, so the column is added
-- lazily by src/schedule.js ensureScheduleDetailColumn() with a PRAGMA guard
-- instead of here — running this file twice must stay harmless.


-- ============================================================ Winterfest 2026
-- Additive 2026-11-22 (docs/WINTERFEST.md §4 Phase 1, workstream 5).
-- PANEL-SIDE MIRROR ONLY: the game (winterfest_core.amxx) owns every number —
-- snowflakes, ornaments, tree slots, Advent claims, pass XP — and pushes a
-- snapshot through the existing signed channel. Nothing here is authoritative
-- and nothing here is ever shown as if it were: the pages read these tables and
-- label them "per the game snapshot".
--
-- Safe migration path: every statement is IF NOT EXISTS, no ALTER, no UPDATE.
-- Booting the runner over the existing live replica (server_local.mjs execs
-- this file) only creates what is missing; src/winter/store.js repeats the same
-- DDL lazily (keyed per DB object) so a deployment that never execs this file
-- still gets the tables on the first push. src/winter/store.js is the consumer.
CREATE TABLE IF NOT EXISTS winter_players (
    steamid          TEXT PRIMARY KEY,
    season           TEXT NOT NULL DEFAULT '',
    snowflakes       INTEGER NOT NULL DEFAULT 0,
    gifts_found      INTEGER NOT NULL DEFAULT 0,
    tree_style       INTEGER NOT NULL DEFAULT 1,   -- 1 classic | 2 tall | 3 wide
    tree_level       INTEGER NOT NULL DEFAULT 0,
    ornaments_total  INTEGER NOT NULL DEFAULT 0,
    advent_claimed   INTEGER NOT NULL DEFAULT 0,
    seen_at          INTEGER NOT NULL DEFAULT 0    -- stale-push guard, like players.last_seen
);

-- The 24-slot tree: one ornament per slot, one slot per ornament.
CREATE TABLE IF NOT EXISTS winter_tree (
    steamid    TEXT NOT NULL,
    slot       INTEGER NOT NULL,                   -- 1..24 (owner decision §6.1)
    ornament   INTEGER NOT NULL,                   -- ornament id from winterfest.ini
    moved_at   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, slot)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_winter_tree_ornament ON winter_tree (steamid, ornament);

-- Ornament ownership cache (the game's inventory, replicated per ornament id).
CREATE TABLE IF NOT EXISTS winter_ornaments (
    steamid     TEXT NOT NULL,
    ornament    INTEGER NOT NULL,
    obtained_at INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT '',          -- present | advent | set | push
    PRIMARY KEY (steamid, ornament)
);

-- Gift log: what this player opened, when, and what it paid. The claim_key
-- makes a replayed push a no-op (the same rule as the BattlePass ledger).
CREATE TABLE IF NOT EXISTS winter_gifts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    steamid     TEXT NOT NULL,
    season      TEXT NOT NULL DEFAULT '',
    instance    INTEGER NOT NULL DEFAULT 0,
    rarity      INTEGER NOT NULL DEFAULT 0,        -- 0..2 (WF_RARITY_MAX)
    reward_type   TEXT NOT NULL DEFAULT '',
    reward_id     INTEGER NOT NULL DEFAULT 0,
    reward_amount INTEGER NOT NULL DEFAULT 0,   -- snowflakes / XP the reward paid
    claim_key     TEXT NOT NULL DEFAULT '',
    opened_at     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (steamid, claim_key)
);
CREATE INDEX IF NOT EXISTS idx_winter_gifts_player ON winter_gifts (steamid, opened_at DESC);

-- Advent claim ledger, one row per player per season per day. The primary key
-- IS the duplicate-claim guard: the second claim of a day can never insert.
CREATE TABLE IF NOT EXISTS winter_advent (
    steamid    TEXT NOT NULL,
    season     TEXT NOT NULL DEFAULT '',
    day        INTEGER NOT NULL,                   -- 1..24
    claimed_at INTEGER NOT NULL DEFAULT 0,
    claim_key  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (steamid, season, day)
);

-- Winter Pass XP/tier. FREE TRACK ONLY (owner decision §6.2): there is no
-- premium column and none is to be added without a new owner decision.
CREATE TABLE IF NOT EXISTS winter_pass (
    steamid    TEXT NOT NULL,
    season     TEXT NOT NULL DEFAULT '',
    xp         INTEGER NOT NULL DEFAULT 0,
    tier       INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (steamid, season)
);

-- Season window + community goal as the game pushes them ('season' |
-- 'community', JSON). Reading these is how the panel knows the season dates
-- without a redeploy; an empty table means "use the documented default window"
-- (1..24 December Europe/Paris).
CREATE TABLE IF NOT EXISTS winter_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
);
