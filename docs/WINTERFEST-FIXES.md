# WINTERFEST-FIXES — what was broken on the test server, and what changed

Branch `winterfest`. Every section is one fix: the symptom as it showed on the
local stack, the root cause with a `file:line`, the change, how it was verified,
and a one-line revert. Fixes are in the order they were found, which is also the
priority order the owner set: **a command that is unusable → a payment that is
wrong → cosmetics → polish**.

Local stack: `bash scripts/wf-local.sh start|restart`, game `127.0.0.1:27016`,
panel `127.0.0.1:18101`, log `build/wf-local/server.log`.

---

## F0 — the repo could not be read at all (recovery, no code change)

**Symptom.** Every git command failed:
`fatal: loose object b66db9c4… (stored in .git/objects/b6/6db9c42…) is corrupt`,
`fatal: bad object HEAD`.

**Cause.** The host restarted mid-write and left four loose objects as 0-byte
files; one of them was the commit `refs/heads/winterfest` pointed at.

**Change.** Deleted only the four 0-byte objects, moved `refs/heads/winterfest`
to the newest commit that survived (`aef8fb8`, read out of `.git/logs/HEAD`),
`git read-tree HEAD`, `git update-index --refresh`. No source file changed; the
working tree was already newer than the new HEAD.

**Verification.** `git status --porcelain` lists no `D` entries (the tree still
matches HEAD), `git fsck` reports no corruption, and the two files that were
edited before the restart (the present-model fix) are in the tree.

**Revert.** None — this only repaired metadata. Do **not** run
`git gc --prune=now`; it would delete the dangling objects that are the last copy
of the lost commit.

---

## F1 — every present drew a glow instead of `models/winterfest/present.mdl`

**Symptom (before).**

```
[winterfest_core.amxx] [WF] prop 'present_common': visual 'present_classic' -> 'sprite_glow_common' (the configured one needs a download)
[winterfest_gifts.amxx] [WF-GIFTS] spawned 7/7 present glow(s)
```

`ls cstrike/models/winterfest/present.mdl` said the file was right there.

**Root cause — two independent bugs, both had to be fixed.**

1. `scripts/wf-local.sh:428` wrote `wf_allow_models 0` into the generated
   `cstrike/wf-local.cfg`. That cvar is the single gate on every model prop, so
   no model could ever be drawn on the test server.
2. The file test itself was wrong for the shipped harness.
   `game-server/cstrike/addons/amxmodx/scripting/winterfest_core.sma:967` did
   `return file_exists(g_szVisAsset[idx])`, a **mod-relative** path
   (`models/winterfest/present.mdl`), and
   `winterfest_gifts.sma:187` did the same for the shipped present. The harness
   runs hlds from the **game root** — `cs16-linux-base/docker/harness/boot.sh:17`
   is `cd "$SERVER"` then `./hlds_linux -game cstrike` — so the working directory
   is `/server`, not `/server/cstrike`, and both tests answered `false` for a file
   that was on disk. (Proof: `docker exec wf-local-27016 sh -c 'cd /server/cstrike
   && [ -f models/winterfest/present.mdl ] && echo OK'` → `OK`, while the same
   test without the `cd` → missing.)

**Change.**

* `winterfest_core.sma`: `WfFileCstrike()` tests the path under both roots
  (`""` then `"cstrike/"`), and `WfVisualUsable()` uses it. The cvar read moved
  into `WfModelsAllowed()` so there is one place that answers "may a model be
  drawn".
* `winterfest_gifts.sma`: `plugin_precache()` keeps the **first existing**
  spelling of the present in `g_szShippedPresent` (`models/winterfest/…` or
  `cstrike/models/winterfest/…`) and precaches exactly that string, so the
  precached path and the drawn path can never disagree. A missing model is still
  never precached — precaching a missing model is how a map ends up with an
  ERROR entity.
* `scripts/wf-local.sh`: the generated config now writes `wf_allow_models 1`
  (with a comment saying what 0 buys back).

**Verification (after, same map, same boot).**

```
[winterfest_gifts.amxx] [WF-GIFTS] models/winterfest/present.mdl is on disk - precached; presents draw the MODEL while wf_allow_models=1
[winterfest_core.amxx] [WF] prop 'present_common': draws model 'models/winterfest/present.mdl'
[winterfest_core.amxx] [WF] prop 'present_uncommon': draws model 'models/winterfest/present.mdl'
[winterfest_core.amxx] [WF] prop 'present_rare': draws model 'models/winterfest/present.mdl'
[winterfest_gifts.amxx] [WF-GIFTS] spawned 7/7 present prop(s): 7 model, 0 sprite
```

**Revert.** `wf_allow_models 0` in `configs/plugins/wf_gifts.cfg` (or in
`cstrike/wf-local.cfg` on the local stack) returns every present to its glow
without a recompile.

---

## F2 — the console command helper sent one argument per command

**Symptom.** `bash scripts/wf-local.sh cmd "wf_allow_models" "wf_force_open"`
reached the server as three separate lines; the console answered
`"wf_allow_models" is "wf_force_open"` — the *name* of the second cvar became the
*value* of the first. Any multi-word command, e.g.
`cmd wf_give Ranger gingerbread 0 10`, was torn apart the same way.

**Root cause.** `scripts/wf-local.sh` `cmd_cmd()` passed `"$*"` (all arguments
joined with spaces, no quoting) to `try_cmd()`, which then wrote that single
string to the console FIFO.

**Change.** `cmd_cmd()` passes `"$@"` and `try_cmd()` writes **one console line
per argument**, in order.

**Verification.** `cmd "wf_allow_models"` prints `"wf_allow_models" is "1"`, and
`cmd wf_give Ranger gingerbread 0 10` now applies the grant (see F3).

**Revert.** Restore `send_cmd "$*"` in `cmd_cmd()`.

---


## F3 — `panel_probe` could not be run at all

**Symptom.**

```
> panel_probe Ranger dashboard
Usage:  panel_probe <player> <kind> [authid] - show the panel decision without sending it
```

…every time, with the right syntax.

**Root cause — two independent defects in the same handler**
(`game-server/cstrike/addons/amxmodx/scripting/freenova_panel.sma`).

1. `freenova_panel.sma:4822` (as shipped) called `cmd_access(id, level, cid, 3)`
   — three required arguments — while the command takes **two** and reads the
   third as an *optional* authid override (`read_argv(3, szAuth, …)`). The
   documented form could never pass the argument count, so the command only ever
   printed its own usage line.
2. `freenova_panel.sma:4827` resolved the target with
   `cmd_target(id, szArg, CMDTARGET_ALLOW_SELF)`. From the **console** (id 0)
   `cmd_target()` fails for a name and for `#id` on this AMXX build — the repo
   already knows this: `include/fn_core.inc:85` exists precisely to work around
   it. So the "optional authid" path was the only usable one.

**Change.** `cmd_access(…, 2)`; `fn_resolve_target(szArg)` (the console-safe
resolver from `fn_core.inc`, which also accepts bots); `#include <fn_core>`.

**Verification.** Before/after on the same console line:

```
> panel_probe Ranger dashboard
Usage:  panel_probe <player> <kind> [authid] - show the panel decision without sending it
```

→ (after)

```
[PANEL-PROBE] kind=dashboard target=path /dashboard.html auth=BOT lpm=unloaded url=none
```

**Revert.** `cmd_access(…, 3)` and `cmd_target(id, szArg, CMDTARGET_ALLOW_SELF)`.

---

## F4 — the copy of `freenova_panel` on the test server was a stale binary

**Symptom.** The fixes above were compiled, copied into
`game-server/cstrike/addons/amxmodx/plugins/`, and the plugin list still
answered with the OLD text; deleting `freenova_panel.amxx` from the tree made the
console answer `bad load: Plugin file open error (plugin "freenova_panel.amxx")`
while `amx_plugins` listed it as **running**.

**Root cause.** `scripts/wf-local.sh` synced 11 Winterfest plugins and the
Winterfest configs, and nothing else — but the assembled tree ships its **own**
builds of the core FreeNova plugins. The tree's `freenova_panel.amxx` was dated
2026-11-23 while the one this repo had just built was dated today, so AMXX kept
loading the old class.

**Change.** `sync_plugins()` now also refreshes `freenova_panel` and
`freenova_sync` from the repo's `plugins/` when that file exists there, and says
so (`refreshed from this repo: freenova_panel freenova_sync`). Winterfest's own
11 modules were already covered.

**Verification.** `amx_plugins` after a restart lists
`FreeNova Panel 1.0 … freenova_pa  running` together with the new
`[PANEL-PROBE]` lines, and the Winterfest plugins are unaffected
(`85 plugins, 85 running`).

**Revert.** Delete the `for p in freenova_panel freenova_sync` block in
`sync_plugins()`.

---

## F5 — `fn_open_panel()` claimed the wrong answer about itself

**Symptom.** A diagnostic that asked `fn_open_panel(id, kind)` and then
`fn_panel_denied()` got "denied=0" — read as *accepted* — for a call that was
refused. The kind it asked about was `winter`; the kind the helper had actually
answered for was `dashboard`.

**Root cause.** `include/freenova_web.inc:574` is a single global
`g_iFnPanelDenied` that `fn_open_panel()` writes **only on the paths it takes**:
the "no page configured" branch returns before it is ever set, and
`FN_PANEL_OK` (the value for "nothing ran yet") is indistinguishable from "this
call was accepted". A caller cannot re-ask either, because asking again changes
the answer.

**Change.** The helper now records `(kind, answer)` on every call and exposes
`fn_panel_last_answer(kind)` → `1` accepted, `0` refused, `-1` never asked for
that kind. Nothing in the refusal paths changed; this is an observation API for
diagnostics. Proved by the probe plugin (`tools/probes/zz_test_matrix.sma`),
which prints all eight Winterfest kinds and the dashboard in one pass.

**Verification.** `[WF-MATRIX] panel winter -> 0 (denied=1, last_answer=0)` and
the same for tree/gifts/ornaments/advent/pass/spin/dashboard — no kind ever
reports a stale "accepted".

**Revert.** Drop the two globals and `fn_panel_last_answer()`; nothing shipped
calls them.

<!-- FIXES CONTINUE BELOW -->

---

# Still broken / needs the owner

*(filled in at the end of the run)*
