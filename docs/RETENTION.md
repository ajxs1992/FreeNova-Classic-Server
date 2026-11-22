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
* One latent bug was fixed on the way through: the roll blob has 28 cells (five
  daily, three bonus and four weekly target/status pairs plus the VIP target,
  progress, status and the rerolls already used) but 1.1.0 formatted 27, so the
  last one was never written and every reconnect handed the day's free rerolls
  back. The 28th cell is written now; a blob from the old build simply has no
  28th cell and reads as 0, which is exactly the old behaviour.

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

---

## 3. VIP: what it actually grants

Tiers are `VIP` (1), `VIP+` (2), `VIP Elite` (3); higher tiers include lower
ones. Everything below was checked against the source, not against the comments
in the config files — several of those are wrong (see the end of this section).

### The honest table

| Perk | Tier | Applied by | Key (default) |
|---|---|---|---|
| Chat tier tag / coloured name | VIP | `freenova_vip.sma` `HandleChat` | `vip_tag` (VIP), `vip_tier_tags` (1) |
| Join / leave notice | VIP | `Task_VipIn`, `client_disconnected` | `vip_in_out` (1) |
| Scoreboard badge | VIP | `Task_SetVipTab` | `vip_tab` (1) |
| Kill AP + money (kill / headshot / knife variants, AP capped) | VIP | `client_death` | `vip_ap_kill` 10, `vip_ap_hs` 10, `vip_ap_kill_knife` 15, `vip_ap_hs_knife` 20, `vip_money_kill` 400, `vip_money_hs` 600, `vip_max_ap` 200 |
| CT defuse kit on spawn | VIP | `OnPlayerSpawn` | `vip_defusekit` (1) |
| Rank-XP multiplier | VIP | `fnvip_get_xp_multiplier` → `battlepass_core` `crxranks_user_receive_xp` | `fnvip_mult_xp_1..3` (**vip.cfg: 1.10 / 1.20 / 1.30**) |
| Coin multiplier (kill coins only) | VIP | `fnvip_get_coin_multiplier` → `battlepass_core` | `fnvip_mult_coin_1..3` (**vip.cfg: 1.05 / 1.10 / 1.15**) |
| Spawn armour (kevlar + helm) | VIP | `battlepass_core` (not this plugin) | — |
| Player model | VIP / VIP+ | `weapon_models.sma` (`PMODEL_VIP` need 1 for `vip_ct`/`vip_tero`, 2 for `s1_vip_*`) | — |
| Spawn money | VIP+ | `OnPlayerSpawn` | `vip_start_money` (1000) |
| VIP Armory `/vmenu` (+ per-map blocklist) | VIP+ | `Cmd_VMenu`, `ArmoryAccess`, `configs/vipMaps.ini` | `vip_mode` (1) |
| Damage-indicator HUD | VIP+ | `client_damage` | `vip_bulletdmg` (1), `vip_bulletdmg_mode` (5) |
| Parachute | VIP+ | `parachute.sma` (reads this plugin's cvar) | `vip_parachute` (1) |
| Double jump (fallback only when BattlePass has no jump, hard cap 1 air jump) | Elite | `Fwd_VipPreThink` | `vip_jump` (1) |
| Extra daily contract (150 coins) + auto-claim of ready contracts | VIP | `freenova_missions.sma` via `fnvip_get_tier` | — |
| Free daily rerolls (1 / 2 / 3 / 4 by tier) and reroll cost (200 / 200 / 150 / 100) | VIP | `freenova_missions.sma` | — |
| Free-VIP night (whole server gets tier 1) | everyone | `Task_CheckFreeVip` | `vip_free` (1), `vip_free_start` (22), `vip_free_end` (8) |
| 72 h VIP+ trial, once per SteamID | — | `fnvip_claim_registration_trial`, called from `freenova_registration.sma` | — |
| 24 h VIP trials bought with coins | 1/2/3 per purchase | `battlepass_core` shop → `fnvip_grant` | — |
| Discord / registration ad ticker, trial expiry reminders | — | `Task_AdTick`, `TrialReminders` | `fnvip_ad_enabled`, `fnvip_ad_interval` |

### Perks the code or the configs imply, that nothing applies

Each of these is registered (so `amx_cvar` shows it and `vipConfig.cfg` documents
it) but no code path reads or honours it.

| Claim | Evidence |
|---|---|
| **BattlePass XP multiplier.** `vip.cfg` says "BattlePass XP multipliers (progression layer reads these via fnvip)" and `freenova_vip.inc` documents `fnvip_get_bp_multiplier` as 1.05/1.10/1.15. | `grep -rn fnvip_get_bp_multiplier` finds only the `register_native` and the include: **nothing calls it**. VIP boosts *rank* XP; BattlePass XP is not boosted at all. |
| **Kill / headshot HP bonuses** (`vip_hp_kill`, `vip_hp_hs`, `vip_hp_kill_knife`, `vip_hp_hs_knife`), documented in `vipConfig.cfg` "VIP Kill / Headshot Bonuses" | `client_death` grants AP and money only; the four cvars are never read. The code comments say HP-on-kill was removed on purpose: HP is the BattlePass Vampire skill. |
| `vip_max_hp` ("VIP Max Limits") | never read. Only `vip_max_ap` is. |
| Spawn HP / AP (`vip_start_hp`, `vip_start_ap`) | never read. Spawn armour belongs to `battlepass_core`, which explicitly owns it. |
| `vip_admin_flag` ("flag required for the Admin model") | never read; the admin model is keyed on `ADMIN_BAN` inside `weapon_models.sma`. |
| `vip_model 0` disables VIP models | read only to skip *this* plugin's model precache. Models are applied by `weapon_models.sma`, so 0 does not remove them. |
| `fnvip_has_benefit` / `FNVIP_BENEFIT_*` ("benefit gate") | no plugin in the tree calls it; the gate is inert. Its own comment puts VIP skins at VIP+ while `web-panel/src/vip.js` sells shop skins at tier 1. |
| `vip_jump 2` = triple jump (`vipConfig.cfg`) | `Fwd_VipPreThink` hard-caps at one air jump; 2 can never be honoured. |
| `vip_show_hud` (documented in `vipConfig.cfg`) | no such cvar exists any more — the stats HUD moved to `freenova_hud`. |
| Advertised magnitudes: the web panel says `+50 / +100 / +150 %` XP and `1.5x / 2.0x / 2.5x` coins | live values are the ones in `vip.cfg`: `+10 / +20 / +30 %` XP and `1.05x / 1.10x / 1.15x` coins. The in-game `/vip` page is computed from the cvars and therefore shows the low numbers; the web page is hardcoded and wrong. |

Unused tier defines (`TIER_MODEL`, `TIER_PARACHUTE`, `TIER_MULTIJUMP`,
`TIER_FREEVIP`) are leftovers; the real gates are the ones in the table above.
`vipConfig.cfg` is regenerated only when missing, so its stale text survives an
update — it is documentation, not behaviour.

### What changed in this round

1. **Free-VIP could get stuck.** `Task_CheckFreeVip` returned immediately when
   `vip_free` was 0, so switching the event off with the cvar (or while the
   server was inside the window) left every player who had been granted the
   event flag holding VIP until the map changed. The guard was redundant —
   `IsFreeVipTime()` already answers false when the cvar is off — so it now
   always falls through to the teardown branch.
2. **The HP cvars stopped advertising a perk nobody gets.** `vip_hp_hs` (10),
   `vip_hp_kill_knife` (15) and `vip_hp_hs_knife` (20) now default to 0, like
   `vip_hp_kill` already did, with a comment saying HP-on-kill is the BattlePass
   Vampire skill. Nothing reads them either way, so no gameplay changed.
3. **The `/vip` benefit table says what it does.** It now lists the Elite
   double jump (only when `vip_jump` is on) and the VIP extra contract /
   auto-claim (only when `freenova_missions` is loaded), and the player-model row
   no longer claims VIP gets no model — VIPs do (`vip_ct`, `vip_tero`).

### Left to the owner (no code change made)

* **BattlePass XP multiplier**: build it (a BP-XP credit hook) or delete
  `fnvip_mult_bp_*` and the `fnvip_get_bp_multiplier` native. It is currently a
  promise the server does not keep, and `battlepass_core` is owned elsewhere.
* **The advertised numbers**: either raise `fnvip_mult_xp_*` / `fnvip_mult_coin_*`
  to the +50/100/150 % the panel sells, or fix `web-panel/src/vip.js`. This is a
  money/XP decision, so it was not touched.
* **Kill HP**: keep it as a BattlePass Vampire exclusive (current behaviour) or
  turn the four cvars back on with a cap. Both are balance calls.
* **`vip_model`, `vip_admin_flag`**: they only mean something inside
  `weapon_models.sma`, which was out of scope here.
* **Triple jump**: honouring `vip_jump 2` is a movement/exploit decision.

---

## 4. Achievements: no reward can be lost

### What it does today

`freenova_achievements.amxx` keeps one nVault blob per player
(`freenova_bp`, key `ach#<authid>`): the unlocked bitfield, seven lifetime
counters (kills, headshots, plants, defuses, wins, revives, best streak) and the
payout markers. 14 achievements, each paying coins once:

| Achievement ids (`freenova_achievements.inc`) | Trigger | Coins |
|---|---|---|
| `ACH_KILLS_100` / `_1000` / `_5000` | lifetime kills | 250 / 250 / 500 |
| `ACH_HS_100` / `ACH_HEADS_500` | lifetime headshots | 250 / 500 |
| `ACH_PLANTS_50`, `ACH_DEFUSES_25`, `ACH_WINS_100` | lifetime bomb/round counters | 250 |
| `ACH_LEVEL_26` / `ACH_LEVEL_52` | BattlePass tier (rank level fallback) | 250 / 1000 |
| `ACH_PRESTIGE_1` | rsu prestige ≥ 1 (hidden from the visible count) | 250 |
| `ACH_STREAK_10`, `ACH_COINS_10000`, `ACH_REVIVER` | best streak, coin balance, revives | 500 / 250 / 500 |

Achievements pay **coins only**. BattlePass XP is missions-only by design: the
old `ach#N` XP award is deliberately never credited, and the legacy XP marker in
the vault is read and discarded.

### Every unlock path (and the panel)

There is exactly **one** function that unlocks an achievement:
`GiveAchievement()`. It is reached from exactly one place,
`UnlockAchievementsFromStats()`, which is called from the join/load path, from
kills, bomb events, round wins and the revive bridge. Every trigger recomputes
every condition from persisted counters, so a missed call can only ever delay an
unlock, never lose it.

**The web panel cannot unlock an achievement.** It is read-only for this system:
`/achievements` renders the unlocked bitfield and the counters, which
`freenova_sync` publishes through `menabp_get_ach_*` (a passthrough to
`fnach_*`). There is no `claim_achievement` / `unlock_achievement` action in
`web-panel/src/sync.js`, the panel writes nothing back for achievements, and the
only thing an admin can edit in the panel is the *display catalog*
(`catalog` key `achievements`: names, art, descriptions) — skin, not unlock.

So the panel can neither pay nor unlock, and nothing in it can lose a reward.
The paths that could are the in-game ones, below.

### Ordering: pay first, then persist

Round one already made this true, and it still holds for every path:
`GiveAchievement()` pays through `menabp_add_coins_once(id, reward, "ach#<id>")`
and only then writes the unlock bit. The award id is the idempotence lock, so
paying first cannot double-pay either: if the process dies between the deposit
and the vault write, the next session re-unlocks the achievement, the native
returns "already awarded" and the coins are not paid twice.

### The gap that was still there, and the fix

The "could not pay yet" marker was a single **amount** per player
(`achpending`), retried with a plain, non-idempotent `menabp_add_coins`. Two
consequences:

* a crash between the successful deposit and clearing the marker paid it again
  on the next session (over-payment);
* the marker could not say *which* achievements were unpaid, so the retry could
  never use the once-only award id that makes a payment exactly-once.

Now the unpaid marker is a **bit per achievement** (11th field of the same vault
blob; old 10-field blobs load unchanged and old builds simply ignore the extra
field). The retry walks the bits and pays each one with
`ach#<id>`, the same award id the unlock used, so it is exactly-once in both
directions: a crash cannot lose the coins and a retry cannot duplicate them. The
pre-existing aggregate amount is still drained (it has no achievement id, so it
can only be a plain deposit) but nothing adds to it any more.

Two smaller guards came with it:

* the retry clears a bit only when the wallet accepted the payment or already
  had it; if the wallet disappears mid-loop the remaining bits are kept for the
  next tick (the 15 s retry task) and the next session;
* a reward whose amount is 0 clears its bit instead of retrying for ever.

The retry task stops as soon as nothing is owed, and the flush-on-event path now
counts both markers, so a player who never sees the retry task still gets paid
on their next kill.

### Left to the owner

* The achievement table (targets and rewards) is still compiled in. It could get
  the same `configs/freenova/achievements.ini` treatment missions got; it is not
  needed for correctness and it changes what players are paid, so it was not
  done here.
* `ACH_XP_REWARD` still exists in the include and is paid nowhere (BP XP is
  missions-only). Either delete it or design the XP payout deliberately.
* `ACH_COINS_10000` ("Coin Magnet") tests the player's **current balance**, not
  coins ever earned, so a player who spends below 10 000 before the next check
  can miss it. Changing that is a design call about what the medal means.

---

## 5. Competitive / season scoring and the `/tournament` page

### What it scores

`freenova_competitive.amxx` is a monthly points ladder. It only scores while
`fnc_enabled 1`, outside knife rounds, and with at least `fnc_min_players` (2)
humans connected.

| Event | Points | Key |
|---|---|---|
| kill | +10 | `fnc_kill_points` |
| headshot kill | +5 on top | `fnc_headshot_bonus` |
| bomb plant | +10 | `fnc_plant_points` |
| bomb defuse | +15 | `fnc_defuse_points` |
| round win (every player on the winning team) | +20 | `fnc_round_win_points` |
| round MVP | +25 | `fnc_mvp_points` |
| teamkill | −15, floor 0 | `fnc_teamkill_penalty` |
| daily competitive missions (auto-claim) | +120 / +130 / +100 / +150 | targets 25 kills / 20 HS / 10 wins / 3 MVP |

So `comp_points = 10·kills + 5·headshots + 10·plants + 15·defuses + 20·wins +
25·MVP − 15·teamkills + mission bonuses`. Plants, defuses, teamkills and the
mission bonuses have **no column of their own** (neither in SQL nor on the
page), so a player's points can never be reconciled from the numbers the web
shows.

The season key is the calendar month (`%Y-%m`), rolled over lazily by the 60 s
autosave, which saves the old month first, re-keys and zeroes the season
counters; a career lifetime total (`fn_comp_career`) survives. Daily missions
reset at midnight. Published fields, all read by `freenova_sync` and stored in
the `players` table: `comp_season`, `comp_points`, `comp_lifetime`, `comp_kills`,
`comp_hs`, `comp_wins`, `comp_mvp`, `comp_msn_k/h/w/m`, `comp_msn_done`.
**Every field the panel reads is published** — nothing renders blank.

### Does `/tournament` agree?

Mostly. The page (`web-panel/src/competitive.js`) reads `comp_points`,
`comp_kills`, `comp_wins`, `comp_mvp` (and selects `comp_hs` without rendering
it), sorts by points then kills, shows a top-10 ladder, the local player's
position and prize tier, the daily missions and the prize table. The prize tiers,
the mission targets and the mission bits all match the plugin.

### Fixed in this round

* **The champion prize was free.** `ComputeSeasonPrize()` ranked by
  `CompRank()` alone, and `CompRank()` reports rank 1 whenever nothing outranks
  the player — including when the rank cache is empty (the start of every month)
  or the player has never scored. `ClaimSeasonPrize()` only refused on
  `CompRank == 0 && (points > 0 || wins > 0)`, so a player with 0 points and 0
  wins was offered "Claim season prize - 10000c" and paid it. The web panel
  refuses exactly that player (`comp_points > 0 || comp_wins > 0`), and
  `freenova_sync`'s own refusal message is literally "You need tournament points
  or wins to claim prizes!" — the plugin was the only half that did not check.
  The rank tiers now require one point or one win (wins are checked too because
  teamkill penalties clamp points at 0). Nothing else about the ladder changed.

### Listed, not fixed (design or panel-side)

* **Rank tie-break disagreement.** The plugin ranks by points then kills
  (`CompRank`, and the DB query behind `/ctop`). The panel's position is
  `COUNT(*) + 1 WHERE comp_points > ?` — points only, no tie-break. Two players
  level on points both read `#1` on the web, both see the champion tier, and the
  second claim is rejected by `freenova_sync` with "invalid prize tier". Making
  the plugin points-only would mint duplicate champions, so this needs an owner
  ruling; the panel's query is out of scope for this branch either way.
* **The web ladder has no season filter.** It reads `comp_points` for all rows,
  so a player who has not reconnected since the rollover keeps last month's
  points and keeps ranking. The plugin's own queries are season-scoped.
* **Board size.** The web shows a top 10; the in-game `/ctop` and the prize
  ladder say TOP 15.
* **`comp_history` is never written.** `web-panel/src/sync.js` inserts into it
  from `payload.season_history`, and no plugin emits that field, so final
  standings are not preserved anywhere: the "final standings" view reconstructs
  a finished season from `players` rows that the next connection overwrites.
* **The daily mission is called RIFLEMAN in game and FRAG HUNTER on the web**
  (same metric, same 25 kills). Cosmetic; the name lives in
  `freenova_comp.inc` too, which this branch does not own.
* **`comp_hs` is published and stored but the live page never renders it** (only
  the unused `pageTournament` in `pages.js` does). `comp_lifetime` is shown
  nowhere live.
* **Wording:** the panel's prize tiers say "match wins" where the plugin counts
  round wins.
* **No library guard in `freenova_sync`**: if `freenova_competitive` were ever
  removed from `plugins.ini`, the `fncomp_*` calls in the sync payload would
  silently publish zeroes instead of failing loudly. (Not changed: `plugins.ini`
  and `freenova_sync.sma` are out of scope for this branch.)
* **Bot guard.** The kill path does not test `is_user_bot()` (the death and damage
  paths do); "kills involving bots score nothing" rests on the ranking provider,
  not on this plugin.

---

## 6. Deploying this round

Nothing here needs a `plugins.ini` change. All five plugins are already loaded
on the live server, and the two new config files are optional: with neither file
present, missions run on the compiled-in contract table and events run on the
old dice driver.

Upload, for each changed plugin, **both halves** (precedent: the round-one
plugin commits):

| File | Why |
|---|---|
| `addons/amxmodx/scripting/freenova_missions.sma` + `plugins/freenova_missions.amxx` | config-driven contracts |
| `addons/amxmodx/scripting/freenova_randevent.sma` + `plugins/freenova_randevent.amxx` | scheduled windows, no stacking |
| `addons/amxmodx/scripting/freenova_vip.sma` + `plugins/freenova_vip.amxx` | free-VIP teardown, honest benefit table |
| `addons/amxmodx/scripting/freenova_achievements.sma` + `plugins/freenova_achievements.amxx` | per-achievement reward retry |
| `addons/amxmodx/scripting/freenova_competitive.sma` + `plugins/freenova_competitive.amxx` | champion prize needs points or wins |
| `addons/amxmodx/configs/freenova/missions.ini` (new) | contract table, 1:1 with the old compiled-in one |
| `addons/amxmodx/configs/freenova/events.ini` (new) | event windows, `mode = random` by default |

Then change the map (or `rcon amx_map <current>`): every config file is read
once per map, at plugin load.

Rollback: restore the previous `.amxx` files. The two `.ini` files can be left in
place (events defaults to `mode = random`; missions' rows are the old table) or
deleted, in which case both plugins fall back to their compiled-in tables.

Two operational notes:

* `MANIFEST-game-server.sha256` was **not** regenerated by this branch. Whoever
  deploys has to, and `amxxpc` is not byte-reproducible (`docs/DEPLOY-plugins.md`
  §1), so compare the compiler-reported sizes, not checksums.
* The vault record `freenova_events` (key `state`) is new and lives next to
  `freenova_bp`. It holds one line; deleting it only loses the "which window is
  running / already ran" memory for the current occurrence.
