# PRECACHE-BUDGET.md — the 512-item ceiling, who spends it, and how to get a map back

GoldSrc gives a map load **one** precache table. The 513th item is fatal:

```
Host_Error: ED_ParseEdict: Model '*239' failed to precache because the item count is over the 512 limit.
Reduce the number of brush models and/or regular models in the map to correct this.
```

`*N` is a **brush model** — an entity in the map's model lump, not a `.mdl` a
plugin asked for. So the crash is never "one model too many": it is the whole
stack (engine base + map + every plugin's `precache_model`/`precache_generic`)
arriving at the ceiling while the map is still laying out its own brushes.

Everything below was measured on 2026-11-22 with the local ReHLDS harness
(`cs16-linux-base`, `--profile freenova`), not estimated.

---

## 1. What this found — read this part first

Three maps overflow the budget **with the plugin stack exactly as deployed**:

| map | in the live `mapcycle.txt`? | boot result | dies at |
|---|---|---|---|
| `de_torn` | **yes, line 17** | fatal, 512 overflow | brush model `*236` |
| `de_piranesi` | **yes, line 8** | fatal, 512 overflow | brush model `*231` |
| `cs_havana` | no — retired (2026-11-22) | fatal, 512 overflow | brush model `*239` |
| `de_dust2` | yes, line 1 | green | — |

`cs_havana` was taken out of the rotation for a crash that **`de_torn` and
`de_piranesi` reproduce today, from the live cycle**, on the same six-core
profile: `de_torn` is the *heaviest* map in the `cstrike/maps/` tree (320 map
items, against `cs_havana`'s 245). Retiring the third-worst map did not protect
the server; it moved the accident to a different map.

That is the operator decision at the end of this document (§9). What follows is
the measurement and the one knob that buys the budget back.

---

## 2. How the numbers were obtained

Two independent sides, both from `tools/precache-report.py` (new, §8) plus
harness boots:

* **Map side** — every entry in a `.bsp`'s model lump is a precached model (that
  is where `*239` comes from), plus the `model` / `message` / `sound` / `noise`
  keys named by entities. Read straight out of the `.bsp`, no guesswork.
* **Plugin side** — every `precache_model` / `precache_generic` /
  `precache_sound` call site in the `.sma` files of the **loaded** plugin stack,
  resolved to the number of distinct resources it emits: a literal is 1, a loop
  over a declared array is that array's staged size, and a loop over a config
  file is that file's live rows. Duplicates cost nothing (the engine returns the
  existing index for an already-precached string), so every number here is a
  count of *distinct resources*.
* **The boundary itself** — boots. A map either reaches `Round_Start` or dies
  with the `Host_Error` above, and the `*N` in the message says how far it got.
  That is the only way to see the third component, the engine's own base set,
  which no file on disk can be asked about.

What is **not** measured, and why the totals below do not add to 512: the
engine's stock precache (player models, weapon `v_`/`w_`/`p_` models, HUD
sprites, base sounds) and any resources a map names in ways §2's key list does
not cover. On `cs_havana` the accounted-for items are 245 + 130 = 375, so the
unaccounted base is around 137. That residue is fixed for a given engine build;
the two measured sides are what a change can move.

---

## 3. Who precaches what

Loaded stack: 70 plugins from `plugins.ini`. Total plugin-side distinct
resources: **130**.

| named | bound | sites | plugin | what it is |
|---:|---:|---:|---|---|
| **97** | 16 | 18 | `weapon_models` | 81 distinct `.mdl` from `configs/skins_menu.cfg` (viewmodel + player model per row, 103 rows), plus 12 premade player models |
| 12 | 12 | 12 | `reapi_healthnade` | 3 models from cvars, 4 sounds, 2 `.txt`/`.spr` HUD files, 3 sprites |
| 7 | 7 | 7 | `freenova_cosmetics` | `shockwave.spr`, `laserbeam.spr`, `steam1.spr`, `glassgibs.mdl`, 3 sounds — **all stock Half-Life/CS resources the engine already precached**, so they are close to free |
| 6 | 6 | 6 | `battlepass_core` | 2 legend player models + 4 sounds |
| 3 | 3 | 3 | `rt_planting` | bomb/planting models |
| 2 | 2 | 2 | `parachute` | viewmodel + pack model |
| 1 | 4 | 4 | `freenova_vip` | one model per VIP tier from a cvar table |
| 1 | 1 | 1 each | `cmdmenu`, `rt_sounds`, `freenova_roundmusic` | single sprites / a track table |
| 0 | 0 | — | the other 61 plugins | no precache at all |

`weapon_models` is **75 % of the whole plugin-side budget** and the only number
big enough to matter. Everything else combined is 33 resources, and most of
those are stock files.

The one place the scanner cannot resolve a count from the source is a precache
loop that walks a config file; for `weapon_models` that is `skins_menu.cfg`, and
`tools/precache-report.py` reads that file's live rows directly. 103 rows, 151
model-path slots, **81 distinct `.mdl` files** — every one of them present in the
FastDL mirror, so none of them are skipped by the plugin's `file_exists()`
check.

---

## 4. The map side

`.bsp` model lump + named entity resources, ranked. The live rotation contains
the three heaviest entries that are not `de_dust2`-sized.

| total | models | res | ents | map | in cycle |
|---:|---:|---:|---:|---|---|
| 320 | 299 | 21 | 597 | `de_torn` | **yes** |
| 261 | 237 | 24 | 499 | `de_piranesi` | **yes** |
| 245 | 242 | 3 | 434 | `cs_havana` | retired |
| 212 | 208 | 4 | 363 | `de_chateau` | yes |
| 209 | 193 | 16 | 291 | `cs_backalley` | no |
| 209 | 206 | 3 | 245 | `cs_office` | yes |
| 187 | 171 | 16 | 409 | `de_airstrip` | yes |
| 176 | 173 | 3 | 272 | `de_vertigo` | no |
| 175 | 168 | 7 | 238 | `cs_estate` | yes |
| 166 | 163 | 3 | 271 | `de_storm` | yes |
| 163 | 155 | 8 | 246 | `cs_747` | no |
| 161 | 156 | 5 | 262 | `de_cbble` | yes |
| 155 | 155 | 0 | 199 | `de_inferno` | no |
| 144 | 128 | 16 | 260 | `de_survivor` | yes |
| 140 | 136 | 4 | 234 | `cs_siege` | no |
| 110 | 102 | 8 | 178 | `cs_italy` | yes |
| 43 | 43 | 0 | 101 | `de_dust2` | yes |

Reproduce with:

```sh
tools/precache-report.py --maps \
  --map-dir /path/to/cs16-linux-base/build/server-freenova/cstrike/maps
```

---

## 5. The reduction: `fn_skins_precache_max`

One knob, in `weapon_models`, on the biggest consumer, **default off**.

```cfg
// configs/plugins/weapon_models.cfg   (optional file; absent = today's behaviour)
fn_skins_precache_max 8
```

* `0` (the default) precaches every row of every group — byte for byte today's
  behaviour, nothing else in this change is reachable.
* `N > 0` precaches the first `N` rows of each of the five skin groups. Rows are
  taken in config order, so slot 0 (the plugin's `Default`) is always kept and
  the rows that get dropped are the tail of each group.
* It is a **cvar**, but it is read in `plugin_precache()`, because after
  `plugin_init()` the models are already in the table. A value that only arrives
  later (i.e. from `amxx.cfg`, which AMXX execs after precaching) cannot give
  the map its slots back — it only lowers what players may wear. So the file is
  exec'd from `plugin_precache()` the same way `reapi_healthnade` reads its
  `HealthNade.cfg`. Set it in that file (or on the server command line); putting
  it in `amxx.cfg` is the one placement that silently does the weaker thing.

Safety, i.e. why a capped skin cannot reach the engine unprecached:

* `CanUseSkin()` — the predicate every consumer already asks (menu, selection,
  `ApplyCurrentWeaponSkin`, the spawn hook) — now returns false for a slot at or
  beyond what was precached. A player wearing a capped skin is reset to
  `Default`, exactly as they already are when they cannot use one.
* That guard matters because the premade path in `ApplyCurrentWeaponSkin()`
  writes `set_pev(pev_viewmodel2, …)` **without** a `ModelPrecached()` check
  (only the custom-skin path above it has one). With the cap in place the count
  check runs first, so a capped slot never gets that far.
* Purchases are untouched: `CanMeetSkinGates()`, which the buy path uses, does
  not know about the cap, so a capped skin can still be bought and equipped on a
  map where there is room.

---

## 6. Measured effect

Boot matrix, `--profile freenova`, harness `de_dust2`-class config, one boot per
cell. `distinct` is how many `.mdl` the cap leaves `weapon_models` precaching
(computed from `skins_menu.cfg`, all files present on disk).

| cap | rows kept | distinct `.mdl` | `de_dust2` | `cs_havana` | `de_piranesi` | `de_torn` |
|---:|---:|---:|---|---|---|---|
| 0 (off) | 108 | 81 | green | **fatal `*239`** | **fatal `*231`** | **fatal `*236`** |
| 40 | 108 | 81 | — | **fatal `*239`** | — | — |
| 22 | 106 | 80 | — | **fatal `*241`** | — | — |
| 20 | 100 | 78 | — | green | — | — |
| 16 | 80 | 64 | — | green | — | — |
| 8 | 40 | 40 | green | green | **green** | **fatal `*279`** |
| 4 | 20 | 25 | — | — | — | **fatal `*291`** |
| 1 | 5 | ~10 | — | — | — | **green** |

Read the `cs_havana` column carefully: the cliff is between **78 and 80** distinct
models. Two models. That map has *no* margin left, and `de_torn` needs the skin
table almost entirely gone (`cap 1`) before it fits.

So:

* **`cs_havana` and `de_piranesi` come back at `fn_skins_precache_max 8`** — 40 of
  81 skin models precached, 8 skins per weapon group, everything else unchanged.
* **`de_torn` does not.** `cap 1` — five rows in total — is the first value that
  boots, which is not a setting anyone would ship: it is the plugin switched off
  in all but name. `de_torn`'s 320 map items do not fit under this stack, full
  stop, and that is an operator decision (§9), not something this knob should
  paper over.

`de_dust2` is green at every cap, which is the point of a default-off knob: the
map everyone actually plays never needs it.

---

## 7. What was deliberately not done

* **No second consumer was cut.** `reapi_healthnade` (12) and `freenova_cosmetics`
  (7, mostly stock files the engine already has) are noise next to 81. Cutting
  them would take the stack from 130 to ~111 and would not save `de_torn`.
* **No model file was deleted, no skin was removed from `skins_menu.cfg`.** With
  the cvar at 0 every skin the players see today is still precached and still
  wearable.
* **`plugins.ini` was not touched.** The knob is off, so the deployed behaviour
  is unchanged by this commit; turning it on is one line in
  `configs/plugins/weapon_models.cfg`.
* **The engine base was not measured.** Doing that needs a debug build that
  prints the precache table; the boot matrix gives the same answer for every
  decision that is actually on the table.

---

## 8. Monitoring it from now on

```sh
tools/precache-report.py                  # the loaded stack, ranked, with totals
tools/precache-report.py --all-plugins    # every .sma in the tree, not just loaded
tools/precache-report.py --maps           # rank every .bsp under cstrike/maps
tools/precache-report.py --map cs_havana --map de_torn --map-dir …/cstrike/maps
                                          # per-map detail + "map + plugins = N / 512"
tools/precache-report.py --json           # for anything that wants to watch a number
```

It exits 0 always (it is a report, not a gate). The numbers to watch: the
`weapon_models` row, and any new plugin that appears above 10. A plugin that
starts precaching a config file should get a `KNOWN_DRIVERS` entry so its rows
are counted instead of landing in the "unresolved call sites" list — that list
is printed for exactly this reason, never silently dropped.

`--map <name>` prints the arithmetic that matters when adding a map:

```
cs_havana            map  245 + plugins  130 =  375 / 512  (ok)
de_torn              map  320 + plugins  130 =  450 / 512  (ok)
```

Both rows say `ok` and both maps are fatal in practice — that is §2's unmeasured
engine base (~137 items). Treat a `total` above ~375 as "will not boot", and
verify with a harness boot before it goes anywhere near the rotation.

---

## 9. For the operator

1. **`de_torn` (cycle line 17) and `de_piranesi` (line 8) are live and fatal.**
   `de_piranesi` is fixed by `fn_skins_precache_max 8`; `de_torn` is not fixed at
   any sane cap. Either drop `de_torn` from `mapcycle.txt` the way `cs_havana`
   was dropped, or accept that it needs a deeper precache cut somewhere else.

   Both are reachable by players, not just by an admin: `configs/maps.ini` is
   comments-only, so `freenova_mapvote` falls back to `mapcycle.txt` for its
   nomination list (`LoadMaps()`, `freenova_mapvote.sma:1158`). A `/rtv` or a
   nomination for either map is enough to take the server down - nobody has to
   type `amx_map`.

2. **Decide the shipped cap.** `8` is the value this document measures; it costs
   61 of 81 skin models and leaves every group with 8 skins. `0` keeps today's
   behaviour and keeps `de_torn`/`de_piranesi` killing the server.
3. **`cs_havana` can go back into the cycle at `cap 8`** — it boots green. Whether
   it should is a content decision; nothing in this change depends on it.
4. Re-check a map with `tools/precache-report.py --map <name>` and one harness
   boot before adding it. `cs_office` (209) and `de_chateau` (212) are the next
   closest things in the rotation.
5. The custom maps that live in `cstrike/maps/` rather than in the stock install
   are heavier still and are **not** in the cycle: `de_museum` 298,
   `de_sunny` 218, `de_forge` 196, `de_tuscan` 188. They are out of reach of the
   vote today, so they are not an incident waiting to happen — but do not add one
   to `mapcycle.txt` or `maps.ini` without a harness boot.
