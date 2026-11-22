# tests/winterfest — the Winterfest test surface

Two kinds of check live here. Run both before you touch a Winterfest file.

## 1. The content pack's unit tests (pure Python, no server)

`test_bsp.py`, `test_gen_spots.py`, `test_content.py` belong to the content
workstream: they validate `configs/freenova/winterfest/*.ini` and
`tools/winterfest/gen_spots.py`.

```bash
python3 -m unittest discover -s tests/winterfest -v
```

## 2. The scripted server scenario (`wf_scenario.*`)

`wf_scenario.sma` is a plugin that drives the real plugins through their natives
and asserts the results, so a whole Winterfest core can be exercised with nobody
at the keyboard. It needs the `cs16-linux-base` harness (ReHLDS + AMXX + the
Freenova plugin stack in a container).

```bash
cd /path/to/cs16-linux-base
./scripts/assemble.sh --profile freenova

# The three plugin lines belong in the repo's plugins.ini (the coordinator adds
# them); for a harness run, append them to the generated build tree instead:
printf 'winterfest_core.amxx\nwinterfest_gifts.amxx\nwinterfest_menu.amxx\n' \
  >> build/server-freenova/cstrike/addons/amxmodx/configs/plugins.ini

# A. a map with its own present rows (de_dust2)
./scripts/test-plugin.sh /path/to/FreeNova-Classic-Server/tests/winterfest/wf_scenario.sma \
    --profile freenova --bots 1

# B. a map with NO rows of its own (fy_snow), which must use the generic '*' set
./scripts/test-plugin.sh /path/to/FreeNova-Classic-Server/tests/winterfest/wf_scenario.sma \
    --profile freenova --bots 1 --map fy_snow \
    --expect /path/to/FreeNova-Classic-Server/tests/winterfest/wf_scenario_generic.expect
```

Both must print `RESULT ok`. `wf_scenario.commands` is sent to the server console
between them: it is the operator half (`wf_force_open`, `wf_give`, `wf_state`,
`wf_reload`, `wf_dump_spawns`), and the expect files assert its log lines.

### What the scenario proves

| check | what it shows |
| --- | --- |
| `reset-clean` | `wf_reset all` wipes the season; its epoch bump lets the player earn again |
| `snow-add`, `grant-once`, `grant-second-key` | the same claim key pays once, a different one still pays |
| `ornament-once` | an ornament is granted once |
| `tree-slot`, `tree-slot-refused`, `tree-clear` | the 24-slot grid: owned ornament in, unowned refused, slot cleared |
| `visual-data`, `visual-model-gated` | the look of a prop is config data and no model is drawn while `wf_allow_models` is 0 |
| `gift-once`, `gift-instance` | a present is added once and keeps its rarity |
| `open-once`, `open-second-pays` | **anti-dupe**: one present opened twice in the same tick pays once; another present still opens |
| `advent-today/late/locked` | today pays, a missed day is claimable late, a future day is refused |
| `pass-xp` | one claim key moves pass XP once and the tier follows |
| `season is closed … not spawned` | the boot (November) spawns no presents |
| `spawned N/N present glow(s)` | once the window opens, the spots resolve and spawn |
| `from map rows - ok (rule: 6-10, default 8)` | the map's own rows satisfy the owner's 6–10 rule |
| `from generic * rows - ok` (run B) | a map with no rows falls back to the generic set |

Not covered here because the harness has no human client: the menus themselves,
walking to a present, the opening theatre, and the death pouch. Those are listed
as "needs a human to confirm" in `docs/WINTERFEST-DEV.md` §11.3.

### Running the two boots repeatedly

The vault survives between runs (it lives in the build tree), and the scenario
starts with `wf_reset all` for exactly that reason. Do not remove that line: the
second run would otherwise see the first run's claim keys and report duplicates
as failures.
