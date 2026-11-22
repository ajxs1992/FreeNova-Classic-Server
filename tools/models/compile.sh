#!/usr/bin/env bash
# compile.sh - turn a GoldSrc .qc into a .mdl, on this machine, with no packages
# installed on the host.
#
#   tools/models/compile.sh tools/models/present.qc
#   tools/models/compile.sh tools/models/present.qc --out /tmp/out --keep
#
# Route A (the one that works here): 32-bit studiomdl.exe under wine, inside a
# throwaway i386 Debian container. The host's own wine is a wow64-only build
# that cannot start *any* PE32 image - not studiomdl, not even Valve's own
# hlds.exe - so the container is not a workaround for a broken prefix, it is the
# only 32-bit Windows on this box. Full story in docs/MODELS.md.
#
# The compiler binary is never committed: find it with $STUDIOMDL, at
# tools/models/bin/studiomdl.exe, or let this script pull it out of the
# owner's Sven Co-op archive.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${GOLDSRC_IMAGE:-goldsrc-smd:1.0}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/goldsrc-smd"
SMD_RAR="${SMD_RAR:-/home/ajxs/Desktop/Projects/cs16/_profile-tools/goldsrc/sven_studiomdl_2019.rar}"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merr\033[0m %s\n' "$*" >&2; exit 1; }

qc=""; out=""; keep=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) out="${2:?}"; shift 2 ;;
    --keep) keep=1; shift ;;
    --image) IMAGE="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) qc="$1"; shift ;;
  esac
done
[ -n "$qc" ] || die "usage: compile.sh <model.qc> [--out DIR] [--keep]"
[ -f "$qc" ] || die "no such qc: $qc"
qc="$(cd "$(dirname "$qc")" && pwd)/$(basename "$qc")"
qcdir="$(dirname "$qc")"
out="${out:-$qcdir}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

command -v docker >/dev/null 2>&1 || die "docker is required (it is the only 32-bit Windows here)"

# --------------------------------------------------------------- studiomdl.exe
find_studiomdl() {
  local p
  for p in ${STUDIOMDL:+"$STUDIOMDL"} "$HERE/bin/studiomdl.exe" \
           /tmp/smdtest/studiomdl.exe "$HOME/smdwork/t/studiomdl.exe"; do
    [ -f "$p" ] && { printf '%s\n' "$p"; return 0; }
  done
  if [ -f "$SMD_RAR" ]; then
    local tmp; tmp="$(mktemp -d)"
    for ex in unrar 7z 7za bsdtar; do
      command -v "$ex" >/dev/null 2>&1 || continue
      case "$ex" in
        unrar) unrar x -o+ "$SMD_RAR" '*/studiomdl.exe' "$tmp/" >/dev/null 2>&1 || true ;;
        7z|7za) "$ex" x -y -o"$tmp" "$SMD_RAR" '*/studiomdl.exe' >/dev/null 2>&1 || true ;;
        bsdtar) bsdtar -xf "$SMD_RAR" -C "$tmp" --include='*studiomdl.exe' 2>/dev/null || true ;;
      esac
      local hit; hit="$(find "$tmp" -name studiomdl.exe -print -quit 2>/dev/null || true)"
      if [ -n "$hit" ]; then mkdir -p "$HERE/bin"; cp "$hit" "$HERE/bin/studiomdl.exe"; rm -rf "$tmp"; printf '%s\n' "$HERE/bin/studiomdl.exe"; return 0; fi
    done
    rm -rf "$tmp"
  fi
  return 1
}
SMD_EXE="$(find_studiomdl)" || die "no studiomdl.exe found. Put one at $HERE/bin/studiomdl.exe or set STUDIOMDL=/path/to/studiomdl.exe"

# ------------------------------------------------------------------- the image
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  say "building $IMAGE (i386 Debian + wine 8.0, one time, ~110 s)"
  docker build -t "$IMAGE" -f "$HERE/Dockerfile.studiomdl" "$HERE" >/dev/null || die "image build failed"
fi

# -------------------------------------------------------------------- staging
# Stage under $HOME, never /tmp: the docker daemon on this box has its own /tmp,
# so a bind mount from /tmp silently shows the container an empty directory.
mkdir -p "$CACHE"
WORK="$(mktemp -d "$CACHE/build.XXXXXX")"
cleanup() { [ "$keep" -eq 1 ] && { say "staging kept at $WORK"; return; }; rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK/game/models/winterfest" "$WORK/home"
chmod -R a+rwX "$WORK" 2>/dev/null || true

qcdirwin="$(basename "$qc")"
# every SMD/BMP the QC mentions must sit next to it
for f in "$qcdir"/*.smd "$qcdir"/*.bmp; do
  [ -e "$f" ] && cp -f "$f" "$WORK/game/models/winterfest/"
done
cp -f "$qc" "$WORK/game/models/winterfest/$qcdirwin"
cp -f "$SMD_EXE" "$WORK/studiomdl.exe"
chmod a+rx "$WORK/studiomdl.exe"

LOG="$WORK/studiomdl.log"
say "compiling $(basename "$qc") -> $(basename "${qc%.qc}").mdl"

# wine needs Windows paths and its own cwd, so the container gets a script rather
# than a line of nested quoting
cat >"$WORK/run.sh" <<RUN
#!/bin/sh
# the source path in the qc is resolved against studiomdl's working directory,
# so run from the mod root exactly as a Windows user would
cd /work/game || exit 1
wineboot -i >/dev/null 2>&1
wine /work/studiomdl.exe -game 'Z:\\work\\game' 'models\\winterfest\\$qcdirwin'
RUN
chmod +x "$WORK/run.sh"

set +e
docker run --rm \
  -v "$WORK:/work" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/work/home -e WINEDEBUG=-all \
  "$IMAGE" sh /work/run.sh >"$LOG" 2>&1
rc=$?
set -e

sed -e 's/\r$//' "$LOG" | grep -vE '^\s*$' | tail -25 || true

produced="$WORK/game/models/winterfest/$(basename "${qc%.qc}").mdl"
if [ ! -f "$produced" ]; then
  die "studiomdl produced no .mdl (exit $rc). Full log: $LOG"
fi

cp -f "$produced" "$out/"
for f in "$WORK/game/models/winterfest/"*.bmp; do
  [ -e "$f" ] && cp -f "$f" "$out/"
done
ok "wrote $(basename "$produced") ($(stat -c%s "$produced") bytes) to $out"
for f in "$out"/*.bmp; do [ -e "$f" ] && ok "wrote $(basename "$f") ($(stat -c%s "$f") bytes)"; done

# a parsed sanity check, so a green compile is not the only evidence
if command -v python3 >/dev/null 2>&1 && [ -f "$HERE/mdl_inspect.py" ]; then
  python3 "$HERE/mdl_inspect.py" "$out/$(basename "$produced")" | sed 's/^/    /'
fi
