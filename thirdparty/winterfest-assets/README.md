# Winterfest asset pack (owner-supplied, 2026-11-22)

Extracted from the eight archives in
`/home/ajxs/Desktop/Christmas Update CS 1.6 FreeNova Classic/`. **Nothing here is
enabled.** Every `.mdl`, `.mp3` and `.wav` is client content: it only works once
the download path is proven (fastdl mirror or direct server download — see
`docs/WINTERFEST.md` §1.1). The four plugin sources are reference material for
our own modules, not dependencies.

## Client assets — **Phase 3, gated on downloads**

| file(s) | what it is | planned use |
| --- | --- | --- |
| `christmas_models/…/present1.mdl` | wrapped present | Winterfest gift model (replaces the stock-sprite glow) |
| `christmas_models/…/c4-christmastree.mdl`, `c4-christmastree2.mdl` | tree models | planted-C4 replacement in December |
| `christmas_models/…/snow_tree.mdl`, `green_tree3.mdl` (from `christmastree`) | trees | in-game tree prop at map center |
| `christmas_models/…/sneeuwman.mdl`, `frost_man.mdl` | snowmen | map props / reindeer-hunt targets |
| `christmas_models/…/traineau_2.mdl` | sleigh | Santa's sleigh fly-by |
| `christmas_models/…/lekstok.mdl` | candy cane | ornament/weapon flavour |
| `angry-snowman/models/player/guerilla/guerilla.mdl` | snowman player model (replaces guerilla) | seasonal player model |
| `snowball_throwable_44831/cstrike/models/{p,v,w}_flashbang.mdl` | snowball as flashbang | snowball-fight visuals |
| `ghost_dead_plugin/…/sp_sky_ghost_xmas_v1.mdl` | sky decoration | skybox flavour |
| `santa_flying/models/santa_ykrashenie.mdl` | flying Santa | sleigh fly-by |
| `xmas sound/…/sound/xmas/*.mp3` (11), `xmas_ct6.wav` | round sounds | Christmas round music |
| `sp_hats_xmas/` (already in `game-server/cstrike/models/sp_hats/`) | 7 hats | hats cosmetic set |

## Plugin sources — reference only (do not compile into our tree)

| file | author | lines | what it does | who should look |
| --- | --- | --- | --- | --- |
| `christmastree/…/ChristmasTree.sma` | wopox1337 | 390 | spawns a tree model at a position, lang file | tree workstream |
| `santa_flying/ghost.sma` (+ `ghost.amxx`) | — | 262 | an entity flying across the map (sleigh) | gameplay modes (`winterfest_reindeer`/sleigh) |
| `xmas sound/…/xmas_round_sounds.sma` | A k c 3 n 7 | 74 | plays an mp3 at round start | atmosphere (`winterfest_atmos`) |
| `ghost_dead_plugin/…/ghost_deats_sky.sma` | steelzzz | 92 | sky decoration | atmosphere |

These are third-party code of unknown licence: **read them, take the technique,
write our own**. Do not paste them into `game-server/cstrike/addons/amxmodx/scripting/`
— our modules must pass `tools/lint-plugins.py` and the review bar, and a
dropped-in plugin also has no `LibraryExists` guards, no bot checks and no
`fn_mode` arbitration.

## Naming for the registries

The cosmetics registry (`configs/freenova/winterfest/cosmetics.ini`, workstream 8)
and the gift model mapping should refer to these by id, never by path, so the day
downloads work it is a config edit:

`present_classic` → `models/present1.mdl`, `tree_classic` → `models/snow_tree.mdl`,
`tree_green` → `models/green_tree3.mdl`, `snowman_angry` → player model,
`c4_xmas` → `models/c4-christmastree.mdl`, `sleigh_santa` → `models/traineau_2.mdl`,
`santa_fly` → `models/santa_ykrashenie.mdl`, `snowball_flash` → flashbang models,
`hat_xmas_red|blue`, `hat_elf_red|green|blue`, `hat_lich` (already staged),
`sound_xmas_ct[1-6]`, `sound_xmas_te[1-5]`.
