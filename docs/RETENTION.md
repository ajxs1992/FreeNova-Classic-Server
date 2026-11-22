# Retention systems — how missions, events, VIP and achievements actually behave

Operator page for the four retention systems on the FreeNova Classic server. It
says what each one does **today** (read from the source, not from comments),
what the new config files add, how to change behaviour without rebuilding
anything, and what was deliberately left to the owner to decide.

Everything here is behind the plugins already listed in `plugins.ini`. If a
change needs a `plugins.ini` edit, this page says so explicitly — nothing in
this round added, removed or reordered a plugin.

| System | Plugin | Config today |
|---|---|---|
| Missions / contracts | `freenova_missions.amxx` | `configs/freenova/missions.ini` (**new**) |
| Random + scheduled events | `freenova_randevent.amxx` | `configs/freenova/events.ini` (**new**) |
| VIP | `freenova_vip.amxx` | `configs/freenova/vip.cfg`, `configs/vipConfig.cfg`, `configs/vipMaps.ini` |
| Achievements | `freenova_achievements.amxx` | compiled-in table (no config) |
| Competitive / season scoring | `freenova_competitive.amxx` | compiled-in table (no config) |

Config files are read **once per map**, at plugin load. Edit, then change the
map (or `rcon amx_map <current>`); a live map keeps the table it started with.

---

## 1. Missions and contracts

### What it does today

`freenova_missions.amxx` runs four independent contract groups. Progress is
per player, stored in the shared `freenova_bp` nVault under
`daily#<yyyymmdd>#<authid>`, `daily2#<yyyymmdd>#<authid>`,
`weekly#<iso-week>#<authid>` and `roll#<yyyymmdd>#<authid>`;

| Group | Slots | Resets | What the default table asks | Pays |
|---|---|---|---|---|
| daily | 5 | midnight (server time) | kills, headshots, bomb plants, bomb defuses, round wins | **500 BP XP** when all five are claimed, nothing per slot |
| bonus ("daily extra") | 3 | midnight | best kill streak, damage dealt, rounds survived | 150 / 100 / 100 coins, paid per slot on claim |
| weekly | 4 | ISO week change | kills, headshots, bomb plants, round wins | **5000 BP XP + 1000 coins** when all four are claimed |
| VIP extra | 1 | midnight | 20 kills, VIP tier only | 150 coins |

Each slot is a **target variant**: the old build had a pool of four targets per
slot and rolled one of them per player per period (for example daily kills were
10 / 15 / 25 / 40 with equal chance). Progress, target and status per slot are
persisted; a player keeps the roll they were given until the period resets.

Missions are claimed in game (`/missions`, which opens the web panel page) or by
VIP players automatically. A claim pays **before** the slot is marked claimed,
and every payment is once-only per period, so a claim interrupted mid-way is
retried instead of lost. Coins and BP XP come from `battlepass_core`; if the
player's wallet is not loaded yet the claim refuses and stays claimable.

Round/plant/defuse/kill/damage/survive events only count when
`amx_knife_round_active` is 0, never count bots as earners, and stop while
`rsu_missions` is loaded (that plugin is not enabled).

### The new config: `configs/freenova/missions.ini`

The contract table is no longer compiled in. The shipped file reproduces the old
hardcoded table 1:1, so **nothing changes until the file changes**.

Format: a `[settings]` block of `key = value` lines, then `[mission]` rows of
ten pipe-separated fields.

```
[settings]
season            = 1
daily_set_xp      = 500
daily_set_coins   = 0
weekly_set_xp     = 5000
weekly_set_coins  = 1000
daily_set_slots   = 0
weekly_set_slots  = 0

[mission]
;      id              | type  | slot | metric    | target | weight | xp | coins | season | tags
daily_frags_15        | daily | 0    | kills     | 15     | 1      | 0  | 0     | 1      | daily,frags
bonus_streak_5        | bonus | 0    | streak    | 5      | 1      | 0  | 150   | 1      | bonus,streak
weekly_hs_25          | weekly| 1    | headshots | 25     | 1      | 0  | 0     | 1      | weekly,headshots
vip_extra_20          | vip   | 0    | kills     | 20     | 1      | 0  | 150   | 1      | vip,extra
```

Field reference:

| Field | Meaning |
|---|---|
| `id` | Label used in log lines only. Not shown in game yet. |
| `type` | `daily`, `bonus`, `weekly`, `vip`. |
| `slot` | 0-based slot inside the type. **Fixed counts**: daily 0-4, bonus 0-2, weekly 0-3, vip 0. See "What is protocol" below. |
| `metric` | What advances the slot: `kills`, `headshots`, `plants`, `defuses`, `wins`, `streak`, `damage`, `survives`. Aliases `frags`, `hs`, `bomb_plants`, `bomb_defuses`, `round_wins`, `survive` are accepted. |
| `target` | Progress needed. Must be > 0. |
| `weight` | Chance weight among rows sharing the same `type`+`slot`. `0` keeps a row in the file but never rolls it (staging). |
| `xp`, `coins` | Paid **the moment that slot is claimed**. `0` = nothing. |
| `season` | Season tag. A row whose season differs from `[settings] season` is skipped with a log line, so next season can be staged in the same file. Empty = inherit. |
| `tags` | Free-form labels, comma separated, reserved for the panel. The plugin does not read them. |

Reward model: a slot pays its own `xp`/`coins` on claim, then finishing a **set**
pays the `*_set_*` values from `[settings]`. `daily` and `weekly` are the only
groups with a set bonus by default; `vip` keeps its own 150 coins. The VIP slot is
gated in code on `fnvip_get_tier(id) >= VIP`, so no row can make a non-VIP earn
it.

`daily_set_slots` / `weekly_set_slots` let a set complete before every slot is
claimed (`0` = all used slots). Example: `daily_set_slots = 4` with five daily
slots means "claim any four" — the fifth stays claimable.

### Validation: what happens when the file is wrong

Every row is validated while loading. A bad row is skipped with one
`[FreeNova Missions] missions.ini:<line> …` line in `addons/amxmodx/logs/`, and
the rest of the file is still applied:

* unknown `type`, `slot` out of range, unknown `metric`, `target` <= 0 → row skipped
* negative `xp`/`coins` → clamped to 0 with a log line
* `weight` 0 → row inactive (logged as "inactive (weight 0)")
* a row whose `season` is not the active season → staged (logged, not an error)
* another row for a `type`+`slot` that declares a different `metric`, `xp` or
  `coins` → the slot keeps its **first** row's values and the disagreement is
  logged. Rows sharing a slot are target variants; metric and reward belong to
  the slot.
* more than 8 variants for one slot → extra rows skipped
* a group where **every** row was rejected, or a missing file → that group falls
  back to the compiled-in table with one warning. The server always boots with
  four working groups.

The load ends with one summary line:

```
[FreeNova Missions] contract table from freenova/missions.ini: 48 rows, season '1',
slots daily 5/5 bonus 3/3 weekly 4/4 vip 1/1, 0 group(s) on built-in
```

### What is protocol, and what the config cannot change

* **Slot counts and group order** are read by other plugins: `freenova_sync`
  packs the daily/bonus/weekly/VIP status digits into fixed decimal fields and
  publishes progress by slot index, `freenova_hud` tracks a slot by
  `group:slot`, and the web panel (`/missions`) renders five daily, three bonus
  and four weekly rows with fixed titles. The config changes the rows inside a
  slot, never how many slots exist.
* A slot with **no valid row** is marked claimed and never rolled, so it cannot
  block set completion. The panel will still draw a row for it and label it
  "Done" — the panel's labels/targets are not config-driven yet.
* **Changing a slot's `metric`** works in game (the counters follow the metric)
  but the panel's description of that slot is hardcoded ("FRAG HUNTER: Get N
  ranked kills" for daily slot 0). Keep the metric per slot stable until the
  panel learns the file; the tags column exists for that.
* Vault formats did not change, so a player mid-period keeps their progress,
  targets and completion flags after the upgrade. Target rolls stored before the
  change stay valid even if the pool in the file changes.

### Turning it on

Ship `configs/freenova/missions.ini` and the rebuilt `freenova_missions.amxx`
together, then change the map. To go back: delete or rename the ini — the
plugin falls back to its compiled-in copy of the shipped table, which is the
1.1.0 behaviour.

---

## 2. Events: dice and scheduled windows

### What it does today

`freenova_randevent.amxx` boosts one `battlepass_core`/`freenova_sync`/panel cvar
for a while, then puts it back. It is the *fallback* event driver: it never
overrides an event somebody else (the panel, `freenova_progression`'s happy
hour) already started.

| Cvar | Owner | Effect |
|---|---|---|
| `fn_event_xp_mult` | `freenova_sync` | XP multiplier, 1.0 = off |
| `fn_event_coins_mult` | `freenova_sync` | coin multiplier, 1.0 = off |
| `fn_double_xp` | `freenova_panel` | 0/1 flag, panel contract |
| `fn_happy_hour` | `freenova_progression` | happy-hour multiplier, 1.0 = off |

Today the plugin picks one of the four channels at random every
`fn_re_min`..`fn_re_max` minutes (20..45), rolls a magnitude (1.5..3.0 for the
multiplier channels, 1 for double, 2.0 for happy hour), announces in chat and
HUD, and reverts after `fn_re_duration` minutes (10). `fn_re_enabled 0` stops
all of it.

Only **one** channel is boosted at a time. That is deliberate: `freenova_sync`
multiplies the xp and coin multipliers into what players earn, so two events at
once would multiply the multipliers. The skip-when-active check exists for
exactly that.

### The new config: `configs/freenova/events.ini`

Optional. **Missing or unreadable = the 1.1.0 behaviour above**, so the file can
be deleted with no service impact.

```
[settings]
mode = random            ; random | schedule | both

[flavor]
;      name   | weight | min | max          (these are the 1.1.0 values)
xp     | 25 | 1.5 | 3.0
coins  | 25 | 1.5 | 3.0
double | 25 | 1.0 | 1.0
happy  | 25 | 2.0 | 2.0

[window]
;      id            | days      | start | end   | flavor | multiplier
midweek_xp           | wed       | 20:00 | 22:00 | xp     | 2.0
weekend_coins        | sat,sun   | 14:00 | 18:00 | coins  | 1.5

[map]
;      map        | multiplier
; de_dust2           | 1.25
```

* **`mode`** — `random` (default: dice only, as today), `schedule` (only the
  windows run), `both` (windows run, dice fills the gaps).
* **`[flavor]`** — the weighted pool used by the dice driver and by any window
  whose flavour is `-`. `weight 0` disables a channel everywhere. `min`/`max` is
  the rolled magnitude in 0.1 steps, clamped to 1.0..5.0 (`freenova_sync`'s
  accepted range). For `double`/`happy` set `min = max`.
* **`[window]`** — a fixed event window: which weekdays (`sun..sat`,
  `weekday`, `weekend`, or `0..6` with 0 = Sunday), the local start and end clock
  time, the flavour (`-` = roll from the pool) and a fixed magnitude (empty/0 =
  roll `min`..`max`). A window must end after it starts on the same day; a
  window that crosses midnight is rejected with a log line, split it into two
  rows.
* **`[map]`** — a magnitude multiplier for one map, applied to every event
  opened there (dice and windows), after the flavour/window value and before the
  1.0..5.0 clamp. `double` is a 0/1 flag and is never scaled. Shipping the file
  with no `[map]` row means every map is 1.0 — the shipped file has the two
  example rows commented out on purpose, so adding the file changes nothing.

Validation is the same shape as missions: a bad row is skipped with one
`[FreeNova][RandEvent] events.ini:<line> …` log line and the rest still applies.
If `mode` is `schedule`/`both` and no window validated, the plugin logs it and
stays on dice.

### Windows across a map change (the part that must not regress)

`REVIEW.md` §5.2 was: an event that fired just before a map change left its cvar
boosted for ever — everything after it skipped as "already active". Round one
fixed that by reverting on unload. Windows make it harder, because a window is
supposed to *continue* across the map change, so "revert and forget" is not
enough.

The plugin therefore keeps one record in its own nVault (`freenova_events`, key
`state`): the window, its end time, the flavour, the value it wrote, **the value
that was there before**, and whether a revert is still owed. On every map start:

1. if a previous map left a channel boosted, the **recorded prior** is written
   back (and only if that channel still holds the value the plugin wrote, so a
   panel-driven event that took over is never clobbered);
2. if the window is still inside its time range, it is re-opened for the time
   that is left, using the recorded prior — so the multiplier is applied to the
   real baseline, never on top of its own boost;
3. if the window's end has passed, nothing is re-opened and the record stays as
   the "already handled today" marker for that occurrence, so a window cannot
   fire twice in the same day.

Limitation, stated plainly: the end time is compared with the **local wall
clock** at second-to-minute granularity, so a DST jump during a window ends it
up to an hour early or late. Nothing else about it is time-sensitive.

### Turning it on

Ship `configs/freenova/events.ini` and the rebuilt `freenova_randevent.amxx`,
then change the map. To run a fixed window: copy one of the `[window]` rows into
place and set `mode = schedule` (windows only) or `mode = both` (windows plus
dice). To keep the current random behaviour: leave `mode = random`, or delete
the file.
