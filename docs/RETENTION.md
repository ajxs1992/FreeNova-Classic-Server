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
