# FreeNova Winterfest 2026 — what we can ship, and how

Written 2026-11-22. **8 days to December 1st.** This document is the contract
between the feature wish-list and what a GoldSrc server can actually do. Read
§1 before arguing with §4.

---

## 1. The two hard constraints

### 1.1 Anything the client must download is blocked
FastDL points at `https://fastdl.fn-gaming.net/cstrike/`, which is a **separate
copy we cannot write** (see `docs/MAPS.md`). Consequences, no exceptions:

| blocked until fastdl works | why |
| --- | --- |
| Christmas player models (Santa, Grinch, Elf, Reindeer) | `.mdl` per client |
| Christmas weapon skins (AK/M4/AWP/Deagle/Glock/USP/knife, frozen, candy cane, golden) | `.mdl` + `.bmp` per client |
| Christmas sounds, ambient music, gift-opening audio | `.wav`/`.mp3` per client |
| Snow-covered / winter maps, map decorations, Christmas lights on maps | `.bsp` + `.wad` per client |
| Custom snow / sparkle / sleigh sprites | `.spr` per client |

This is ~60 % of the visual wish-list. It is a hosting problem, not a coding
problem: the day fastdl is fixed, all of it becomes a two-day upload.

### 1.2 What GoldSrc genuinely cannot do
Stated once so nobody plans around it:

- **No animations in the MOTD.** The in-game MOTD is an ancient embedded
  browser (MSIE-class). No CSS animations, no transforms that matter, no SVG
  animation, no video. Static HTML only — `web-panel/src/motd.js` documents this.
- **No per-player 3D scene editing.** "Place ornaments wherever you want on a
  3D tree" is not a thing in this engine. It becomes a **2D tree on the panel**
  with a placement grid, and a compact text summary in game.
- **No physics, no particle systems, no client-side UI.** "Presents shake, the
  ribbon unties, the lid opens with physics" → we can do screen fade, a HUD
  sequence, a stock sprite burst and a chat line. That reads as "opened", not as
  a Pixar short.
- **No real weather.** Snow storms / reduced visibility / slippery movement have
  no engine support without a custom map and client content.

### 1.3 What works with **zero** client downloads (this is the whole plan)
Stock assets every CS 1.6 client already has, engine messages, and data:

- chat / HUD / dhud text, screen fade, screen shake, view punch,
- **stock sprites** through `TE_SPRITE` / `env_sprite` (e.g. `sprites/glow01.spr`
  as a falling snowflake or a present glow) — precached from the client's own
  library,
- proximity pickup logic, timers, menus, per-player state in nvault,
- the **panel** (a real browser: CSS, SVG, animation, responsive) for anything
  that deserves to look good,
- the HMAC sync channel the panel already trusts, and the `actions` channel for
  server-side effects.

---

## 2. What Winterfest is, in one sentence
**A collectable tree on your panel profile, fed by presents you find in game,
with an Advent calendar and a seasonal pass that make December worth logging in
for every day** — and every other feature feeds it.

That is also the recommendation from the original brief, and it survives every
constraint above, because it is *data plus presentation*, not client content.

---

## 3. The systems, mapped onto what already exists

| Winterfest system | built on | status |
| --- | --- | --- |
| Snowflake currency + gift/ornament inventory | nvault per player (new prefix `wf_`), panel replica + `players` columns | new, cheap |
| Personal tree (placement, level, completion %) | panel `tree` table + `/winter/tree` page; in-game `/tree` text + MOTD link | new, cheap |
| Gift spawns in the world | `env_sprite` with a **stock** sprite + distance check, 3 rarities, respawn timer | new, medium |
| Gift opening | fade + HUD sequence + stock sprite burst + chat + reward roll | new, cheap |
| Ornament collection + secret sets | config JSON in `configs/freenova/winterfest.ini` + `badges` table for titles | new, medium |
| Advent calendar (24 days) | date gate + claim-once ledger; panel page + `/advent` | new, cheap |
| Winter Pass (30 tiers) | the **same ledger pattern as BattlePass XP** (`bp_track.js` is the model) | new, medium |
| Christmas missions | `missions.ini` already loads 48 rows from config — add a seasonal file | existing |
| 12 Days of Christmas | `events.ini` already schedules windows | existing |
| Leaderboards (gifts, tree, ornaments) | `boards.js` + `periods.js` already exist for week/month | existing |
| Community goal | panel table + MOTD bar + one plugin counter | new, cheap |
| Secret Santa / gifting between players | panel-mediated, claimed in game | new, medium |
| Christmas UI (panel) | `motd.js` + `pages.js` skin swap; website can animate, MOTD cannot | new, medium |
| Santa's Revenge, Grinch Mode, snowballs, reindeer hunt, boss fight | **gameplay modules** — each a mode; they plug into the `fn_mode` arbiter being built now | new, later |
| Christmas models/skins/sounds/winter maps | **blocked on fastdl** (§1.1) | blocked |

---

## 4. Phasing

### Phase 1 — ship by **Nov 30** (the December-1 product)
Everything a player touches on day one, none of it needing a download:

1. `winterfest_core.amxx` — currency, inventory, tree state, advent claims, one
   save path, `plugin_end` + disconnect persistence, nvault key prefix `wf_`,
   natives for the other modules, admin commands (`wf_give`, `wf_reset`, `wf_state`).
2. `/christmas` hub menu + `/gifts`, `/opengift`, `/tree`, `/ornaments`,
   `/advent`, `/winterpass`, `/christmashop` — real entries, not stubs.
3. **Gift spawns**: 6–10 spots per map from `winterfest.ini` (map + origin +
   rarity), stock-sprite glow, walk-over pickup, respawn 120 s, one per player
   per spot per round.
4. **Opening**: rarity-weighted reward roll (snowflakes, ornament, cosmetic if
   fastdl later, title), fade + HUD sequence, anti-dupe ledger.
5. **Panel**: `/winter` hub, `/winter/tree` (2D tree, placement grid, ornaments),
   `/winter/gifts`, `/winter/ornaments`, `/winter/advent`, `/winter/pass` — same
   auth and no-JS contract as the MOTD pages, plus a richer animated version on
   the public site.
6. **Winter Pass**: 30 tiers, XP from gifts/missions/advent, free track only in
   Phase 1 (premium later if wanted — the BattlePass already has the machinery).
7. **Data**: one `winterfest.ini` (presents per map, ornament catalogue, advent
   table, pass rewards) + `schema.sql` additions + sync payload fields + tests.

Acceptance: a new player types `/christmas`, finds a present on dust2, opens it,
sees the ornament in `/tree` on the panel, claims day 1 of the Advent calendar,
and gains Winter Pass XP — with **zero** downloads and no new client asset.

### Phase 2 — first two weeks of December
12 Days windows in `events.ini` (one per day, different multiplier), seasonal
missions file, gift/tree/ornament leaderboards on the existing `boards.js`,
community goal, Secret Santa, Christmas ad rotation (data only), panel skin.

### Phase 3 — the day fastdl is fixed
Models, weapon skins, sounds, winter map rotation, snow-storm events with real
maps, sleigh fly-by. Two days of upload plus a config change, because Phase 1
and 2 were built to say "cosmetic id X", not "this hardcoded model".

---

## 5. Non-negotiables (learned the hard way in this repo)

1. **No new dependency gets to break the server.** Every module is individually
   disableable; `winterfest_core` missing ⇒ everything else pauses itself
   (`LibraryExists`), like `fn_servers` does.
2. **No reward duplication.** Every grant goes through one idempotent function
   with a claim key — the rule the BattlePass ledger just adopted.
3. **No client asset in Phase 1.** If it is not stock, it waits.
4. **Nothing touches the existing XP/coin/BattlePass tables** except by adding
   columns; the stale-push guard in `sync.js` stays exactly as it is.
5. **Everything is config.** Dates, rewards, present spots, ornament list and
   pass tiers live in files, so December 2027 is an edit, not a rewrite.
6. **It must be reusable.** The same shape serves Halloween (pumpkins, haunted
   tree), Easter (eggs) and Summer: `winterfest.ini` carries a season name, the
   logic is not Christmas-hardcoded.

---

## 6. Decisions (owner, 2026-11-22)

1. **Tree placement: fixed grid.** 24 slots per tree; the three tree styles ship
   three different slot layouts (classic triangle, tall, wide). Ornaments are
   dragged between slots on the panel; in game `/tree` shows `level`, how many of
   the 24 slots are filled and the next milestone.
2. **Winter Pass: free track only.** 30 tiers, no paid track anywhere in the
   schema — if that changes, the BattlePass machinery is already there, but no
   premium column is created now.
3. **Advent: 24 calendar days, 1-24 December.** Day *n* unlocks on 1 December 2026.
   A day that was missed stays **claimable until the season closes** (24 December
   23:59 Europe/Paris) at **half value** — a late joiner is not punished, and nobody
   can cheapen the first days by skipping them.
4. **Presents: 6-10 spots per map** (default 8; per-map override in the ini).
   **Dying never drops a present.** Death drops a **snowflake pouch** worth a few
   snowflakes instead: it gives kills a small reward without making a death cost
   the thing you were hunting, and it gives other players a reason to move.

