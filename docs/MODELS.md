# MODELS.md — making a GoldSrc prop from scratch

Written 2026-11-22. This is the flow that produced
`game-server/cstrike/models/winterfest/present.mdl`: a wrapped present modelled in
Blender by a script, exported to SMD by our own writer, compiled to a GoldSrc
studio model, and **proven to load in the engine**.

Read §2 if you only want the commands. Read §4 before you touch the compiler —
it is the part that cost the time, and none of it is obvious.

---

## 1. What shipped

| thing | value |
|---|---|
| model | `game-server/cstrike/models/winterfest/present.mdl` — **42 828 bytes (41.8 KB)** |
| texture | `game-server/cstrike/models/winterfest/present.bmp` — 17 462 bytes, 128×128, 8-bit paletted, **embedded in the .mdl** (`$cd`-style copy alongside) |
| precache string | `models/winterfest/present.mdl` |
| geometry | 744 triangles · 392 vertices · 327 normals · 1 mesh · 1 body part · 1 bone (`root`) · 1 sequence (`idle`, 1 frame) |
| bounds | x −12.30 … 12.30 · y −12.30 … 12.30 · z 0.00 … 27.18 (box is 24×24×20, the bow adds 7.2) |
| compiler route | **A** — real `studiomdl.exe` under wine 8.0 inside an i386 Debian container |
| acceptance | `RESULT ok slug=present_smoke` in the local harness, no `Mod_LoadModel`, no `Host_Error` |

Previews (a human should judge these, not the byte counts):

* `tools/models/preview_3q.png` — three-quarter view
* `tools/models/preview_front.png` — front view

The older `thirdparty/winterfest-assets/.../present1.mdl` is untouched and is
still what the Winterfest plugins spawn; swapping it is a content decision, not
part of this pipeline (see §7).

---

## 2. The five commands

```bash
# 1. regenerate the model: .blend, .smd, .bmp and both preview PNGs, from script
blender -b -P tools/models/build_present.py -- --out tools/models

# 2. compile the .qc into a .mdl (+ the .bmp next to it)
tools/models/compile.sh tools/models/present.qc --out tools/models

# 3. look at what the compiler actually wrote (layout, winding, sections)
python3 tools/models/mdl_inspect.py tools/models/present.mdl

# 4. copy it into the mod tree
cp tools/models/present.mdl tools/models/present.bmp \
   game-server/cstrike/models/winterfest/

# 5. prove the engine loads it (see §5)
cd /home/ajxs/Desktop/Projects/cs16/cs16-linux-base
flock -w 300 /tmp/cs16-harness.lock ./scripts/test-plugin.sh \
  /home/ajxs/projects/FreeNova-Classic-Server/tests/models/present_smoke.sma
```

Nothing in `tools/models/present.blend` is hand-edited: step 1 rewrites it from
`build_present.py`, so a change to the box size, the ribbon width or the bow is a
two-line diff in git and a re-run.

---

## 3. What each file is

| file | role |
|---|---|
| `tools/models/build_present.py` | the model. Generates geometry, UVs, the paletted BMP, the `.blend`, the previews **and** the SMD from one set of python lists, so the `.blend` and the `.smd` can never disagree. Run through Blender's Python, not a Blender add-on — nothing here depends on an exporter existing in 5.3. |
| `tools/models/present.smd` | generated. GoldSrc reference SMD: `version 1`, `nodes`, `skeleton`, `triangles`. One `root` bone at the origin, flat-shaded triangles with an outward normal and UVs per corner. |
| `tools/models/present.qc` | hand-written, 20 lines: `$modelname`, `$cd`, `$body`, `$bbox`, `$sequence idle`. |
| `tools/models/present.bmp` | generated. Paper (deep red + snow dots), ribbon (gold sheen), bow (pale gold) as three vertical bands; every face's UVs sit inside one band, which is how one texture carries three materials. |
| `tools/models/present.blend` | generated scene, for a human to open and poke at. |
| `tools/models/compile.sh` | `.qc` → `.mdl`. Finds the compiler, builds the container image if needed, stages the tree, runs `studiomdl`, copies the results back, then inspects them. |
| `tools/models/Dockerfile.studiomdl` | the 32-bit Windows the host does not have (see §4). |
| `tools/models/mdl_inspect.py` | read-only MDL v10 inspector: header, bones, sequences, textures, and the triangle command stream including a **winding** verdict. Validated against shipped models. |
| `tools/models/bin/` | where a `studiomdl.exe` may be dropped; gitignored. |
| `tests/models/present_smoke.sma` + `.expect` | the scratch proof plugin (§5). |

`compile.sh` finds `studiomdl.exe` from `$STUDIOMDL`, `tools/models/bin/studiomdl.exe`,
`/tmp/smdtest/studiomdl.exe`, or by extracting
`~/Desktop/Projects/cs16/_profile-tools/goldsrc/sven_studiomdl_2019.rar` (needs
`unrar`/`7z`/`bsdtar`, all present). The binary is third-party and is not
committed.

---

## 4. The compiler — what actually happened

### 4.1 The host's wine cannot run *any* 32-bit program

Every route in the brief was tried on the host first. The failures, verbatim:

```
$ WINEPREFIX=$HOME/.local/share/wine-smd WINEARCH=win32 wineboot -u
wine: WINEARCH is set to 'win32' but this is not supported in wow64 mode.

$ wine studiomdl.exe
Application could not be started, or no application associated with the specified file.
ShellExecuteEx failed:
$ echo $?        # 1

$ wine cmd /c "studiomdl.exe"          # silent, rc 0
$ wine start /wait /unix …/studiomdl.exe
Application could not be started, or no application associated with the specified file.
ShellExecuteEx failed:
$ wineconsole --backend=curses …/studiomdl.exe
error: XDG_RUNTIME_DIR is invalid or not set in the environment.
$ /opt/wine-cachyos/bin/wine …/studiomdl.exe       # wine 11.22 cachyos: same message
$ WINEDLLOVERRIDES= wine studiomdl.exe             # same
$ WINEDLLOVERRIDES='msvcrt,msvcp60=n' wine studiomdl.exe   # silent, rc 53
$ wine 'Z:\work\studiomdl.exe'
wine: failed to open "Z:\work\studiomdl.exe": c0000135
```

It is not the executable. The control test matters: Valve's own 32-bit server
binaries fail identically —

```
$ file ~/Desktop/"Server CS 1.6"/hlds.exe
PE32 executable for MS Windows 4.00 (GUI), Intel i386, 4 sections
$ wine hlds.exe -help
Application could not be started, or no application associated with the specified file.
ShellExecuteEx failed:
```

`hltv.exe` too. And `WINEDEBUG=+process` never creates a process for the image at
all — wine decides it cannot run the file and falls through to `start.exe`, whose
`ShellExecuteEx` also fails. The cause is in the build, not the prefix:

* `/usr/lib/wine/` has `i386-windows/` (624 PE DLLs) and `x86_64-unix/`, but **no
  `i386-unix/`** — there is no 32-bit unix side to back wow64;
* the prefix's `drive_c/windows/syswow64/` exists but is **completely empty** — no
  32-bit `cmd.exe`, so `wine "C:\windows\syswow64\cmd.exe"` cannot even open it;
* `wine --version` is 11.22 and it reports `... not supported in wow64 mode` for
  `WINEARCH=win32`, i.e. this build advertises wow64 while shipping no working
  32-bit emulation.

`winetricks` cannot help: `sudo` is blocked by `no new privileges`, and the
missing piece is a compiled wine component, not a runtime DLL.

### 4.2 What worked: 32-bit Windows in a container

A container gives us the one thing the host lacks — a real i386 userland, where
wine 8.0 has a native 32-bit loader. This is not a hack around a broken prefix;
it is simply where the 32-bit Windows is.

```
i386/debian:bookworm-slim  +  apt-get install wine wine32 libwine
```

`tools/models/Dockerfile.studiomdl` is exactly that, and `compile.sh` builds the
image (`goldsrc-smd:1.0`, ~110 s, one time) if it is missing. Inside it:

```
StudioMDL SC (Nov 30 2018 16:56:14)
Studio Model Compiler for Sven Co-op
```

The Sven Co-op 2019 build writes **IDST version 10** — what ReHLDS loads. Welcome
side effect: this route produces a real, properly stripped/fanned model, so the
hand-written-`.mdl` fallback (route B) was not needed.

### 4.3 Container gotchas, in the order they bit

1. **Docker's `/tmp` is not your `/tmp`.** On this box the daemon has its own
   `/tmp`, so `-v /tmp/work:/work` silently mounts an *empty* directory — and a
   `docker run … true` probe passes anyway. `compile.sh` therefore always stages
   under `$HOME/.cache/goldsrc-smd/build.*`, never `$TMPDIR`.
2. **Wine's `HOME` must live inside the mount and be owned by you**, otherwise
   `wine: '/tmp' is not owned by you, refusing to create a configuration directory
   there` or `wine: chdir to …/.wine : No such file or directory`.
3. **`wine /work/studiomdl.exe` does not work** — an absolute *unix* path makes
   wine look the file up as a builtin module and fail with `c0000135`. Use a
   relative name after `cd`, or `Z:\work\studiomdl.exe`.
4. **`$cd` is resolved against studiomdl's working directory**, not against the
   QC's location — and `$modelname`'s output path is working-directory relative
   too. So run from the mod root:
   `cd /work/game && wine studiomdl.exe -game 'Z:\work\game' 'models\winterfest\present.qc'`
   with `$cd "models/winterfest"` in the QC.
5. **`$cdmaterials` is a Source command.** GoldSrc's compiler answers
   `************ ERROR ************ Bad command "$cdmaterials"`.
6. **`$body studio "present"` — no `.smd` suffix.** It appends `.smd` itself; with
   the suffix you get `./present.smd.smd doesn't exist`.
7. **The SMD material name must be repeated before *every* triangle.** A single
   material header followed by many triangles is mis-parsed: `Grab_Triangles()`
   reads *material line, then three vertex lines*, in a loop, so the second
   triangle's first vertex is taken as a material name and the parse walks off
   the end (`error on line N: end`). This is the one that wastes an afternoon;
   `build_present.py` writes the name per triangle for exactly this reason.
8. **`$sequencegroupsize 4096`** in the QC keeps the animation inside the main
   file. Without it this compiler always emits the sequence into a separate
   `present01.mdl` (IDST/`IDSQ` sequence-group file) and the prop becomes a
   two-file model. 92 bytes, but two files to copy, precache and download.
9. `$sequence idle "present" fps 30` and `$body` may both name the same SMD; the
   file is read twice (`grabbing …` appears twice). That is normal.
10. The trailing `end` of the `triangles` block is accepted once the per-triangle
    material lines are right. Keep it — other tools expect it.

### 4.4 Winding: the bug that would have shipped

GoldSrc culls with `glFrontFace(GL_CW)`, and `studiomdl` **reverses** every
triangle on the way in (`flip_triangles` defaults to 1). So the SMD must be
*wound counter-clockwise as seen from outside*, which is also what Blender's
polygons already are — emit Blender's order and the compiled model comes out
clockwise, which is what the renderer wants.

Getting it backwards produces a model the engine loads happily and renders
inside-out. `mdl_inspect.py` checks it, because "it compiled" proves nothing here:

```
$ python3 tools/models/mdl_inspect.py tools/models/present.mdl | grep winding
          winding: cw=744 ccw=0 flat=0 -> clockwise (GoldSrc)

$ python3 tools/models/mdl_inspect.py \
    "thirdparty/winterfest-assets/christmas_models/Christmas Models/present1.mdl" | grep winding
          winding: cw=48 ccw=0 flat=1 -> clockwise (GoldSrc)
          winding: cw=99 ccw=0 flat=1 -> clockwise (GoldSrc)
```

Our 744 triangles agree with the shipped Winterfest present, triangle for
triangle. (The check works off the triangle *command* stream — `mesh.triindex`
points at interleaved `TRI_STRIP`/`TRI_FAN` counts and
`(vertindex, normindex, s, t)` tuples terminated by `0`, not at a raw trivert
array. `s`/`t` in the compiled model are texel coordinates, not 0..1 UVs.)

---

## 5. Verification — the acceptance test

`tests/models/present_smoke.sma` precaches the prop, spawns it, and asks the
engine what it made of it. `precache_model()` is the call that parses a studio
model, so a non-zero index is ReHLDS's `Mod_LoadModel` saying yes; a malformed
file shows up as a console line instead.

```bash
cd /home/ajxs/Desktop/Projects/cs16/cs16-linux-base
flock -w 300 /tmp/cs16-harness.lock ./scripts/test-plugin.sh \
  /home/ajxs/projects/FreeNova-Classic-Server/tests/models/present_smoke.sma
```

Result (log at `artifacts/present_smoke/console.log`):

```
RESULT ok slug=present_smoke
  ok    expect: \[MDLTEST\] precache model=models/winterfest/present\.mdl index=[1-9][0-9]*
  ok    expect: \[MDLTEST\] spawned ent=[1-9][0-9]* modelindex=[1-9][0-9]* frames=1 bone0=1
  ok    expect: \[MDLTEST\] done rehlds=1
  ok    absent: Mod_LoadModel
  ok    absent: Host_Error
  ok    absent: not precached
  ok    absent: couldn't load
  ok    absent: bad version
  ok    absent: Run time error
  ok    absent: bad load
```

The engine's own words, from the console log:

```
[MDLTEST] precache model=models/winterfest/present.mdl index=2
[MDLTEST] spawned ent=105 modelindex=2 frames=1 bone0=1
[MDLTEST] bone0_origin=0.00,0.00,-100.00
[MDLTEST] done rehlds=1
```

`frames=1` means the **sequence table** was read (our `idle` is one frame), and
`bone0=1` means `GetBonePosition` succeeded on the **bone table** — the engine is
not just reading a header, it built the model. `bone0_origin` equals the entity
origin because the single bone sits at 0,0,0 in model space, which is the intent
for a static prop.

Structure, from `mdl_inspect.py`:

```
ident=0x54534449 version=10 length=42828 name='models/winterfest/present.mdl'
bones=1@244 hitboxes=1@356 seq=1@404 seqgroups=1@580 tex=1@25592
  skinref=1@25672 texdata@25676 bodyparts=1@684
bone 'root' parent=-1 flags=0
hitbox bone=0 (-12.3,-12.3,0) .. (12.3,12.3,27.18)
seq 'idle' fps=30.0 frames=1 blends=1 animindex=388 group=0
texture 'present.bmp' 128x128 data@25676
bodypart 'studio' nummodels=1 modelindex=760
  [file] model @760 name='present' mesh=1 verts=392 norms=327
      mesh @10220 tris=744 skinref=0 norms=327
      winding: cw=744 ccw=0 flat=0 -> clockwise (GoldSrc)
```

Two things worth knowing when reading that back: every offset after the 244-byte
header is a **file-absolute** byte offset (`bodypart.modelindex` 760 lands exactly
at the end of the body-part struct), and a one-file prop must have
`seqgroups=1` — `seqgroups=2` means a companion `…01.mdl` crept back in (§4.3.8).

Also checked by hand, byte for byte, against a model the engine already ships:
`present.mdl`'s section order and sizes match `present1.mdl`'s layout
(header → bones → hitboxes → anim → seqdesc → seqgroup → bodypart → model →
vertinfo → norminfo → verts → normals → meshes → tri commands → textures →
skinref → texturedata).

---

## 6. Making the next prop (snowman, hat, candy cane, …)

1. **Copy `build_present.py`** to `build_<prop>.py` and change `build_mesh()`.
   Keep the pattern: build into a `Mesh` (verts + quads + a UV rect per face),
   give every quad an `outward` hint so the winding fixer can orient it, then let
   the SMD writer dedupe. Sizes are in engine units: 1 unit ≈ 1 inch, a player is
   72 units tall, and a prop you want readable from a few metres is 20–30 units
   per side.
2. **Pick UV bands** in the 128×128 texture by editing `PAPER`/`RIBBON`/`BOW`
   (or add a fourth band) and the palette in `build_bmp()`. One BMP, no external
   files: the compiler embeds it and copies it alongside.
3. **Write the new `.qc`:** copy `present.qc` and change
   `$modelname` to `models/winterfest/<prop>.mdl`, `$body studio "<prop>"`,
   `$cd "models/winterfest"`, and set `$bbox` to the printed bbox (the build
   script prints it). Keep `$sequencegroupsize 4096`.
4. **Build and compile** with the two commands in §2.
5. **Check the winding** — `python3 tools/models/mdl_inspect.py out.mdl | grep winding`
   must say *clockwise*. If it says counter-clockwise, do not ship it: your quads
   are inside-out (the `outward` hint is wrong), and it will render inside-out in
   game.
6. **Copy into `game-server/cstrike/models/winterfest/`**, precache
   `models/winterfest/<prop>.mdl`, and copy
   `tests/models/present_smoke.sma` to a new slug to prove the engine loads it.
7. **Never hand-edit the `.blend`.** If a human nudges the model in Blender,
   port the change back into the script in the same commit, or the next
   regeneration silently discards it.

Budget: this whole thing — model, texture, pipeline, compiler fight, test — is
about 43 KB of client download per prop. That is well inside the "props are
invisible" rule in `docs/WINTERFEST.md` §1.1.

---

## 7. What is *not* done here

* **No animation.** One frame, one bone. A prop that spins or opens needs more
  frames in the SMD `skeleton` block and a matching `$sequence`; the pipeline
  supports it (the SMD is the same format), but nothing here exercises it.
* **The plugins still spawn `present1.mdl`.** This deliverable adds
  `models/winterfest/present.mdl` and leaves every `winterfest_*` plugin,
  `plugins.ini` and the live asset untouched. Switching the spawn is a one-line
  change in whichever plugin owns the gifts, and the owner should decide when.
* **The client download mirror is not involved.** Both files are small enough
  that §1.1's direct-download fallback is a non-event, but the `.mdl` does need
  to reach `fastdl.fn-gaming.net` if the owner wants it instant.
* **Route B (hand-written IDST) was not needed** once the container route worked.
  The format work it required is still in the tree as `mdl_inspect.py`, which is
  what makes the winding and `seqgroups` checks possible.
