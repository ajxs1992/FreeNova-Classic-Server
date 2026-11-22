# SERVER FEEL

How a session on FreeNova CS 1.6 Classic actually plays: who is in the room
when you arrive, what the room does when you leave, what a mode may change, and
what a player is told. Everything here is server-side AMXX/YaPB configuration -
none of it touches XP, coins, Battle Pass progress or rewards.

Owner: server feel. Plugin tree: `game-server/cstrike/addons/amxmodx/scripting/`.
Config: `game-server/cstrike/addons/yapb/conf/` and
`game-server/cstrike/addons/amxmodx/configs/`.

---

## 1. The decisions

Five choices decide what the server feels like. Each one is a deliberate value,
not a leftover, and each has a cvar that changes it without touching code.

### 1.1 Seed population: **5 bots on an empty server**

`fn_bot_seed 5` (script `fn_bots.amxx`, static fallback `yb_quota "5"` in
`yapb.cfg`).

Why 5: it is the smallest population that still produces a real round on every
stock CS map (2v3), it keeps the browser entry credible without pretending to
be a crowd, and it costs the least CPU on a `sys_ticrate 1200` server that is
hosting nobody. Nine static bots - the old `yb_quota 9` - is the number that
made the server look busy and then felt dead the moment you joined, because
every one of them is already busy with each other and none of the slots are
yours.

The population rule (recomputed every 2s and on every connect/disconnect):

```
bots = seed + humans * per_human        (seed when empty)
       capped so bots + humans <= maxplayers - reserve
```

| state | bots | total on a 32-slot server |
|---|---|---|
| 0 humans | 5 | 5/32 |
| 1 human | 6 | 7/32 |
| 10 humans | 15 | 25/32 |
| 27 humans | 3 | 30/32 |
| 30 humans | 0 | 30/32 |

Humans always keep `fn_bot_reserve` (2) slots, and YaPB's own autovacate
(`yb_autovacate 1`, `yb_kick_after_player_connect 1`, `yb_autovacate_keep_slots 1`
in `yapb.cfg`) kicks a bot the instant a human connects to a full server. If an
operator turns autovacate off, `fn_bots` logs a warning instead of overriding
the decision.

### 1.2 Empty server: **hold the current map**

`fn_empty_policy 0` (script `fn_empty.amxx`).

`mp_timelimit 20` with `mp_maxrounds 0` means an empty server rotates its map
every 20 minutes with nobody watching. For a server people join at random from
the browser, the three candidate rules are:

* **rotate as normal** - the map you saw in the browser is not the map you
  connect to, and it may be most of the way through its clock;
* **fast-forward** - same problem, plus a map chosen for an audience that never
  arrived;
* **hold** - the map you saw is the map you get, with the time that was left when
  the last human left it. The clock is frozen (`mp_timelimit 0`) while the server
  is empty and handed back - with the remaining time preserved - on the first
  human connection.

This server holds. `fn_empty_rotate_after 120` (policy 2) puts a bound on
"hold": after two hours of emptiness the held map is released so a dead night
still moves the rotation forward. `fn_empty_policy 1` restores stock behaviour.

Round spam is the other half of the same problem, and it is fixed on the warm-up
side: warm-up no longer starts at map start, only when the first human arrives
(§1.3), so an empty server never sits in a round-restart loop. Bots keep playing
in the held map, by design.

### 1.3 Warm-up: **starts with the first human, ends when the room can play**

`simple_warmup.sma` (rewritten).

Warm-up begins when the first human connects (not at map start), and ends on the
first of: `sw_min_humans` humans connected (default 2), enough `!ready` votes
(`sw_ready_ratio 0.6`, at least `sw_ready_min 1`), `warmup_timer` seconds
(default 90; 0 = no clock, -1 = off), or the last human leaving (which ends it
*without* restarting a round). Ending restarts the round once so everyone
respawns with normal weapons.

### 1.4 Team balance: **3-win streak, or a 2-player advantage, always announced**

`fn_balance.amxx`: `fn_bal_streak 3`, `fn_bal_advantage 2`, `fn_bal_notice 4.0`.

A 3-win streak scrambles both teams; a 2-player imbalance moves one player off
the bigger team. Both are announced in chat when the round ends and applied
`fn_bal_notice` seconds later, inside the same intermission, so the round that
spawns afterwards starts balanced and everybody saw it coming. A move takes a
**bot** first (free), and only then the human who joined most recently.
`fn_bal_on 0` disables the whole thing; `fn_bal_bots 0` makes it humans-only.

The thresholds: 3 wins is the point where "they are just better" turns into "the
teams are wrong", and it is short enough to matter in a 20-minute map. 2 players
is the smallest imbalance that decides a public round without being noise, and
moving one player is the smallest fix that restores it.

### 1.5 Bot chatter: **radio callouts on, dead-chat halved**

`yapb.cfg`: `yb_radio_mode 1`, `yb_chat 0`, `yb_chat_percent 15`
(mirrored live by `fn_bot_chat 1`, `fn_bot_chat_percent 15`).

Radio callouts tell a human where the fight is, so they stay. Random dead-chat
from five bots is the loudest thing on an otherwise quiet server, so it is off
by default and the death line chance is half the stock 30. `fn_bot_chat 2`
restores stock chatter and radio; `fn_bot_chat 0` silences both.

A curated name list replaces YaPB's stock 145-name pool
(`addons/yapb/conf/lang/en_names.cfg`, read at server start). The stock list has
names that are stale, offensive or read like cheat bait - the worst possible
first impression on a server that wants real players.

---

## 2. Cvar reference

Every cvar below is registered by the plugin named in the heading. A cvar that
is missing (older binary) falls back to the behaviour described in
"if unset".

### `fn_bots.amxx` - bot population and behaviour

| cvar | default | what it does |
|---|---|---|
| `fn_bot_enabled` | `1` | master switch for the quorum rule. `0` = never touch `yb_quota` (stock behaviour). |
| `fn_bot_seed` | `5` | bots on an empty server (§1.1). |
| `fn_bot_per_human` | `1` | extra bots wanted per connected human. |
| `fn_bot_max` | `0` | hard ceiling on bots; `0` = derive from maxplayers/reserve only. |
| `fn_bot_reserve` | `2` | slots bots must never occupy, so a human always fits. |
| `fn_bot_difficulty` | `3` | YaPB difficulty level 0-4 (Noob/Easy/Normal/Hard/Expert) - selects the reaction time, headshot chance and aim error of the level in `addons/yapb/conf/difficulty.cfg`. 3 = Hard = today's live setting. |
| `fn_bot_think_fps` | `26` | YaPB bot logic rate (24-90). Lower = slower reaction granularity, higher = sharper and more CPU. 26 = YaPB default. |
| `fn_bot_chat` | `1` | `0` off, `1` radio only (default, §1.5), `2` radio + chatter. |
| `fn_bot_chat_percent` | `15` | chance of a random death line (0-100); stock 30. |

Reaction time and aim error are per-level values in
`addons/yapb/conf/difficulty.cfg` (YaPB 4.4 has no native to set them per bot and
reads that file at start), so they are selected with `fn_bot_difficulty` rather
than typed in free-form:

| level | min/max reaction (s) | headshot % | aim error (x,y,z) |
|---|---|---|---|
| 0 Noob | 0.8 / 1.0 | 5 | 30, 30, 40 |
| 1 Easy | 0.6 / 0.8 | 10 | 15, 15, 24 |
| 2 Normal | 0.4 / 0.6 | 50 | 5, 5, 10 |
| 3 Hard (live) | 0.2 / 0.4 | 75 | 0, 0, 0 |
| 4 Expert | 0.1 / 0.2 | 100 | 0, 0, 0 |

Console: `fn_bots` prints humans, quota, and the mirrored YaPB values.
If unset: `yb_*` keep whatever `yapb.cfg` says.

### `fn_empty.amxx` - empty server policy

| cvar | default | what it does |
|---|---|---|
| `fn_empty_policy` | `0` | `0` hold the map (§1.2), `1` stock (do nothing), `2` hold then rotate. |
| `fn_empty_rotate_after` | `120` | minutes of emptiness before policy 2 releases the held map. |

Console: `fn_empty` prints policy, human count, held state and the remaining
time. If unset: the map rotates as it does today.

### `simple_warmup.amxx` - knife warm-up

| cvar | default | what it does |
|---|---|---|
| `sw_on` | `1` | master switch; `0` = the plugin does nothing. |
| `warmup_timer` | `90` | max seconds of warm-up after it starts. `0` = no clock (wait for humans/`!ready`), `-1` = warm-up disabled. |
| `sw_min_humans` | `2` | end warm-up automatically at this many humans; `0` = never (only `!ready`/timer). |
| `sw_ready_ratio` | `0.6` | fraction of connected humans that must `!ready` to skip; `0` = use `sw_ready_min` only. |
| `sw_ready_min` | `1` | votes always needed to skip. |
| `amx_knife_round_active` | `0` | read by the XP owners; written 1 only while warm-up runs, restored through `fn_mode`. |

Commands: `!ready` (player), `sw_start [force]`, `sw_end`, `sw_status`
(console, `ADMIN_CFG`).

### `fn_balance.amxx` - team balance

| cvar | default | what it does |
|---|---|---|
| `fn_bal_on` | `1` | master switch. |
| `fn_bal_streak` | `3` | consecutive wins that trigger a scramble; `0` = never scramble on streaks. |
| `fn_bal_advantage` | `2` | player difference that triggers a single move; `0` = never. |
| `fn_bal_notice` | `4.0` | seconds between the chat announcement and the switch (clamped 0-8; keep it under `mp_chattime`, which is 10). |
| `fn_bal_bots` | `1` | `1` moves/scrambles bots too (a move takes a bot first); `0` = humans only. |

Console: `fn_bal` (state), `fn_bal_now` (force a scramble, announced).

### `fn_join.amxx` - first-join experience

| cvar | default | what it does |
|---|---|---|
| `fn_join_on` | `1` | master switch; `0` = no welcome line at all. |
| `fn_join_delay` | `5.0` | seconds after connect before the welcome prints (1-20). |
| `fn_join_motd` | `1` | print the second line pointing at `/motd`. |
| `fn_join_motd_file` | `motd.txt` | MOTD file shown by `/motd` (relative to `cstrike/`). |

Two lines maximum: the welcome/pointers line, then a `/motd` pointer.

### `fn_commands.amxx` - `!commands`

No cvars. `/commands [page|term]`, `!commands`, `/cmdlist`, `say_team`
variants; console `fn_commands [page|term]` and `fn_commands_rebuild`.
The list is generated at map start from the AMXX command registry
(`get_concmdsnum`/`get_concmd`), grouped by the plugin that registered each
command, paginated 8 lines per page, and filtered by the caller's admin flags.
`/help` still opens the curated hub menu.

### `fn_servers.amxx` - network browser

No cvars. `configs/fn_servers.ini`, one line per server:
`name | address:port | short description`. `/servers` (and `amx_serversmenu`)
opens the menu for a player; `fn_servers` from the server console prints the
parsed list - that is the post-deploy check. The address is format-validated
before any `client_cmd connect`, a player who disconnects with the menu open is
ignored, and bots/HLTV callers never reach `client_cmd connect`.

### `fn_mode.amxx` - mode arbiter

No cvars. Console: `fn_mode [status|end]` (`ADMIN_CFG`; console always allowed).
API: `include/fn_mode.inc` (§3).

### YaPB configuration touched

| file | change | why |
|---|---|---|
| `addons/yapb/conf/yapb.cfg` | `yb_quota "5"` | static fallback = the seed population, so a server without `fn_bots` still boots as a small living room. |
| `addons/yapb/conf/yapb.cfg` | `yb_radio_mode "1"`, `yb_chat "0"`, `yb_chat_percent "15"` | §1.5. |
| `addons/yapb/conf/lang/en_names.cfg` | 74 curated names | §1.5. |

---

## 3. The mode arbiter (`fn_mode`)

Every non-default mode changes engine cvars that outlive the round it started
in: `mp_freezetime`, `amx_knife_round_active`, `sv_restartround`, event
multipliers. Two modes running at once fight over them, and the loser's restore
writes back the winner's value - which is how `amx_knife_round_active` stayed 1
across a map change and made every XP owner refuse to pay XP for a whole map
(`REVIEW.md` §5.5).

The contract:

```pawn
#include <fn_mode>

fn_mode_begin("warmup", "humans=1", initiator);  // 1 = owned, 0 = refused
fn_mode_set("warmup", "mp_freezetime", "0");     // snapshot + write
fn_mode_set("warmup", "amx_knife_round_active", "1");
fn_mode_end("warmup");                           // restore all, in reverse
```

* **One mode at a time.** `fn_mode_begin` is refused while another mode holds
  the arbiter. The refusal is logged (`[FN-MODE] 'warmup' refused: 'event:xp' is
  active`), sent to every admin's chat, sent to the initiating player
  (`[FreeNova] Can't start warmup: event:xp is already running.`), or printed to
  the server console when the initiator is the console. `fn_mode_refusal()`
  returns the same reason to the caller.
* **No mode writes a cvar directly.** `fn_mode_set` snapshots the pre-mode value
  the first time a cvar is touched and remembers it in a per-mode table;
  unknown cvars are never created (a typo fails loudly at the call site).
* **`plugin_end` restores whatever is still active.** A map change, a plugin
  reload or a plugin that dies mid-mode can never leave a mode running. This is
  proven in the local harness (below).
* **Callers keep a fallback.** A plugin that uses the arbiter checks
  `LibraryExists("fn_mode", LibType_Library)` and keeps its own restore path, so
  a deployment that misses `fn_mode.amxx` degrades to the previous behaviour
  instead of a half-applied mode.

Ported so far: `simple_warmup`. `freenova_randevent`'s window is next: it still
restores through its own vault record (§6), which works and is tested, and the
arbiter would add the "one mode at a time" guarantee on top of that.

---

## 4. Load order

`plugins.ini` order is meaningful and commented in place. Relevant additions:

```
fn_core.amxx        ; platform base
fn_mode.amxx        ; arbiter: before any plugin that begins a mode
fn_servers.amxx     ; network browser (/servers)
...
simple_warmup.amxx  ; begins the "warmup" mode through fn_mode
fn_bots.amxx        ; bot quorum + YaPB behaviour mirrors
fn_empty.amxx       ; empty-server policy
fn_balance.amxx     ; team balance (skips while a mode is active)
fn_commands.amxx    ; /commands from the registry
fn_join.amxx        ; first-join lines + /motd
```

`fn_balance` asks `fn_mode` whether a mode is active before touching teams, so
a warm-up or an admin mode can never be scrambled underneath.

---

## 5. What the local harness proved

`cs16-linux-base`, profile `freenova` (the live plugin stack), on the same
binaries committed here. The two new tests live in the harness repo
(`tests/modes/mode_probe.sma`, `tests/modes/mode_park.sma`) with their
`.expect`/`.commands` files, so they can be re-run against any future tree:

```bash
./scripts/assemble.sh --profile freenova
./scripts/test-plugin.sh tests/modes/mode_probe.sma --profile freenova --bots 2
./scripts/test-plugin.sh tests/modes/mode_park.sma  --profile freenova
./scripts/test-plugin.sh tests/smoke/smoke.sma      --profile freenova
```

Tree-wide, on the same tree: `tools/compile-plugins.sh` -> 143 compiled, 0
failed (137 before this work + 6 new sources; `fn_servers.sma` already existed),
and `tools/lint-plugins.py` -> 0 errors, 38 documented allowances.

1. **Full stack green** - `tests/smoke/smoke.sma --profile freenova`: every
   plugin loaded and running (74 with this change), all modules correct, no
   runtime errors.
2. **Arbiter + warm-up restore** - `tests/modes/mode_probe.sma`: begin a mode,
   write `mp_freezetime 0` + `amx_knife_round_active 1` (both snapshotted,
   `fn_mode_count() == 2`), refuse a second mode with the reason logged, end the
   mode, and both cvars come back to their pre-mode values. Then `sw_start`
   drives the real `simple_warmup` through the arbiter and `sw_end` proves the
   same restore path for the ported mode (with `mp_freezetime` first set to 5, so
   a restore-to-0 leak would be visible).
3. **End-of-map safety net** - `tests/modes/mode_park.sma`: hold a mode, change
   the map, and `fn_mode` logs `plugin_end: 'parked' still active, restored 1
   cvars` - the cvars do not leak into the next map.
4. **Empty-server policy and bot quorum** - `fn_empty` reports `policy=0 (hold)`
   and logs `server empty: map held` on a human-less boot; `fn_bots` reports
   `yb_quota=5` from `fn_bot_seed` with `maxplayers=16` in the harness (32 live).
5. **Console-side room plugins** - `fn_commands` builds the list from the
   registry (`Commands 1-8 of 126`, 33 topics), `fn_servers` from the console
   prints the three configured servers, `fn_bal` reports its thresholds.
6. **Balance mechanics end to end** - `fn_bal_now` plans a scramble, announces
   it, and one second later applies it: `scrambled 5 players into 3 CT / 2 T`
   with the bots the harness spawned.

Three real bugs were found by that verification rather than by the compiler:

* `fn_commands`' topic prettifier wrote into the buffer it was reading, so every
  topic collapsed to one letter (`"A: /amx_help"`). Caught by *reading* the
  generated list in the console log.
* `fn_balance` compared the TeamScore team id against `"CT"`, but the message
  carries one character (`'C'`/`'T'`) - every score looked like a Terrorist win.
  Caught by reading the three existing consumers (`mapchooser`, `statsx`,
  `rsu_matchstats`).
* `fn_balance` used `get_players(..., "ch")` to mean "connected". In this AMXX
  version `c` means *do not include bots*, so the balance logic counted zero
  players on a bot-filled server and a scramble moved nobody. Caught by the
  harness asserting the applied line, not just the plan.

Also fixed on the way: `freenova_randevent` and `freenova_sync` both opened the
`freenova_events` nvault, and AMXX hands the same handle to both - so one
plugin's `nvault_close` invalidated the other's and every map change logged
`Run time error 10 (native "nvault_close")` in `freenova_randevent`. The random
event plugin now owns `freenova_randevent` (its record is one transient window
key, so the split costs at most one window's resume). That is why the
map-change test above can assert "no runtime errors".

## 6. What still needs a real player

* The warm-up gate (`sw_min_humans`) and `!ready` vote need two real clients:
  the harness can only force-start a warm-up with zero humans.
* The balance announcements and clamp: the mechanics are exercised with bots,
  but the streak counter needs complete rounds (`TeamScore` deltas) and "does a
  3-win scramble feel fair" is a human judgement. Watch the first evening of
  3v3+ and check `fn_bal` (it prints both streaks).
* The empty-map hold: the harness proves the policy and the freeze, not the
  resume arithmetic across a real 20-minute map with humans in and out. Check
  `fn_empty` after the first player joins a previously empty server and confirm
  `timeleft` looks like what was left.
* `fn_bot_seed 5`: five bots on an empty server reads as "alive" in the browser.
  If it reads as "fake", lower it to 4; if it reads as "dead", raise it to 6.
  One number, one restart.
* `fn_join` two lines and `fn_commands` pagination: nothing substitutes for
  reading them on a 15" screen in GoldSrc's chat box.

## 7. Next

1. Port `freenova_randevent`'s window onto `fn_mode` (it manipulates
   `fn_event_xp_mult` and already has a careful vault restore; the arbiter adds
   the "one mode at a time" guarantee).
2. A live population card: `fn_bots` already knows humans/bots; exposing
   "5 bots + 2 humans" in the browser reply would make the seed honest.
3. `fn_servers`: live A2S status beside each entry (the menu says "unverified"
   today). Keep the static list as the fallback.
4. Balance: prefer swapping two players over moving one when the imbalance is
   human-vs-human, so the moved player is not always the newest.
