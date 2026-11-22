# Maps: what is in the pool, what is staged, and how a map gets in

## Live pool (24 maps, all stock)
`mapcycle.txt` lists all 24 maps installed on the host, classics first:

```
de_dust2 de_inferno de_nuke de_train de_aztec cs_office de_cbble de_piranesi
de_prodigy cs_italy de_vertigo cs_militia de_airstrip de_chateau de_storm
de_survivor de_torn cs_assault cs_estate cs_backalley de_dust cs_747 cs_siege
as_oilrig
```

`freenova_mapvote` builds its pool **from `mapcycle.txt`**, so this file is the
only place to change what players can vote for. Before this was fixed the cycle
had 15 maps and was missing dust2, inferno, nuke, piranesi, vertigo, storm,
survivor, torn and estate - people could not even vote for dust2.

## Staged community maps (22, verified but **not** in the pool)
Present in `game-server/cstrike/maps/` with their wads, skyboxes, models, sounds,
sprites and overviews. Every one was booted on the real stack (ReHLDS +
ReGameDLL 5.30 + the full 70-plugin set) before being kept:

| maps | result |
| --- | --- |
| `de_tuscan de_cpl_mill de_cpl_strike de_cpl_fire de_dust2002 de_westwood de_kabul_32 de_mirage de_forge de_russka de_eldorado de_sunny de_police_station de_alexandra de_abaddon` | **boots clean** |
| `awp_india awp_dust awp_map awp_city awp_assault awp_lego` | **boots clean** |
| `de_museum` | **excluded** - `Host_Error: ED_ParseEdict: Model '*240' failed to precache because the item count is over the 512 limit`, the same crash that killed `cs_havana` six times |

Why they are not in the rotation yet: they need a download, and
`sv_downloadurl` points at `https://fastdl.fn-gaming.net/cstrike/`, which is a
**separate copy** we cannot update (a file uploaded to the game server does not
appear there). Adding a map to the pool before its files are on fastdl means
every player who does not already have it cannot join. The moment fastdl is
refreshed, add them like this:

```
# 1. upload the map + its content to the game server (tools/deploy.sh does the diff)
# 2. confirm fastdl serves it:   curl -sI https://fastdl.fn-gaming.net/cstrike/maps/de_tuscan.bsp
# 3. add the names to game-server/cstrike/mapcycle.txt
# 4. tools/deploy.sh plugins && restart, then check the console:
#      [FreeNova MapVote] map pool: N maps from mapcycle.txt
```

## The rule for adding any map
1. **BSP version 30** - GoldSrc. A Source map (version 20) loads as garbage or kills the server.
2. **Boot it locally first**: `./scripts/assemble.sh --profile freenova` then
   `./scripts/test-plugin.sh tests/smoke/smoke.sma --profile freenova --map <map>`
   in `/home/ajxs/Desktop/Projects/cs16/cs16-linux-base`. `RESULT ok` or it does not ship.
3. **Precache budget** - the engine has 512 precache items and the plugin stack
   already eats a large share (`fn_skins_precache_max` exists for the skin
   models). `de_museum` and `cs_havana` are what happens when a map does not fit:
   `Host_Error`, core dump, container restart.
4. **Retire, don't delete**: a map that crashes goes to `cstrike/maps/_retired/`
   so `amx_map` cannot kill the server (that is where `cs_havana` lives).

## Retired
`cs_havana` - see `docs/RUNBOOK.md` §5. Six crashes between Oct 26 and Nov 16,
two 140-280 MB core dumps, all from the 512-item precache overflow.
