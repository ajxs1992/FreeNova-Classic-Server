#!/usr/bin/env bash
# Compile every AMX Mod X plugin in the snapshot and report per-plugin PASS/FAIL.
#
# Run from anywhere:  tools/compile-plugins.sh
# Output:             tools/build/plugins/<name>.amxx   (gitignored)
#                     tools/build/plugins/logs/<name>.sma.log
# Exit:               0 only if every .sma compiled.
#
# The bundled compiler (game-server/.../scripting/amxxpc) is a 32-bit i386 ELF and
# needs an i386 runtime. Two runners are supported, tried in this order:
#
#   1. native    - amxxpc runs directly (x86 Linux with i386 libs, e.g. a CI
#                  runner after `dpkg --add-architecture i386`).
#   2. docker    - a 32-bit container. This is what works on the snapshot host,
#                  where the harness' seccomp filter kills every i386 process
#                  with SIGSYS (exit 159) regardless of installed libraries:
#                    docker pull i386/debian:bookworm-slim
#                  Override with AMXX_IMAGE=<image>.
#
# Sources are copied to a scratch directory first: amxxpc writes <name>.amxx next
# to the source by default, and the live scripting/ tree must stay untouched.

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
AMXX="$ROOT/game-server/cstrike/addons/amxmodx"
SRC="$AMXX/scripting"
OUT=${OUT:-$ROOT/tools/build/plugins}
IMAGE=${AMXX_IMAGE:-i386/debian:bookworm-slim}
LOGS="$OUT/logs"

if [ ! -x "$SRC/amxxpc" ]; then
  echo "FATAL: compiler not found or not executable: $SRC/amxxpc" >&2
  exit 2
fi
if [ ! -d "$SRC/include" ]; then
  echo "FATAL: include directory missing: $SRC/include" >&2
  exit 2
fi

rm -rf "$OUT"
mkdir -p "$OUT" "$LOGS"

# ---- pick a runner ---------------------------------------------------------
MODE=none
if "$SRC/amxxpc" -? >/dev/null 2>&1; then
  MODE=native
elif command -v docker >/dev/null 2>&1 && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  MODE=docker
fi

case "$MODE" in
  native) echo "runner: native ($("$SRC/amxxpc" -? 2>&1 | head -1))" ;;
  docker) echo "runner: docker image $IMAGE" ;;
  *)
    echo "FATAL: amxxpc cannot run here and no usable container image is available." >&2
    echo "  native: the binary is a 32-bit i386 ELF - install i386 libs, or run on an" >&2
    echo "          x86_64 host whose seccomp policy allows i386 syscalls." >&2
    echo "  docker: docker pull $IMAGE   (or set AMXX_IMAGE=<image>)" >&2
    exit 3
    ;;
esac

# ---- known-missing includes ------------------------------------------------
# amxxpc 1.10.0.5467 dies with 'std::bad_alloc' instead of naming a missing
# include file, so resolve the includes ourselves to say something useful.
missing_includes() {
  local sma=$1 inc out
  for inc in $(sed -n 's/^[[:space:]]*#include[[:space:]]*<\([^>]*\)>.*/\1/p' "$sma"); do
    if [ ! -f "$SRC/include/$inc.inc" ] && [ ! -f "$SRC/include/$inc" ]; then
      out="${out:-} $inc.inc"
    fi
  done
  for inc in $(sed -n 's/^[[:space:]]*#include[[:space:]]*"\([^"]*\)".*/\1/p' "$sma"); do
    if [ ! -f "$SRC/include/$inc" ] && [ ! -f "$SRC/$(dirname "${sma#$SRC/}")/$inc" ]; then
      out="${out:-} $inc"
    fi
  done
  echo "${out# }"
}

# ---- compile ---------------------------------------------------------------
if [ "$MODE" = native ]; then
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT
  cp -a "$SRC"/*.sma "$SRC"/include "$SRC"/amxxpc "$SRC"/amxxpc32.so "$WORK"/ 2>/dev/null
  ( cd "$WORK" && for f in *.sma; do
      ./amxxpc "$f" -i"$WORK/include" -o"$OUT/${f%.sma}" >"$LOGS/$f.log" 2>&1
      echo "$? $f"
    done ) > "$OUT/.status"
else
  # One container for all plugins: the image has an i386 userland and its own
  # seccomp context, so amxxpc actually executes.
  docker run --rm \
    -v "$AMXX:/amx:ro" \
    -v "$OUT:/out" \
    --tmpfs "/work:exec" \
    -w /work \
    "$IMAGE" sh -c '
      cp -a /amx/scripting/*.sma /amx/scripting/include /work/ || exit 9
      cp -a /amx/scripting/amxxpc /amx/scripting/amxxpc32.so /work/ || exit 9
      chmod +x ./amxxpc
      : > /out/.status
      for f in *.sma; do
        ./amxxpc "$f" -i/work/include -o/out/"${f%.sma}" >/out/logs/"$f".log 2>&1
        echo "$? $f" >> /out/.status
      done
    ' || { echo "FATAL: container runner failed" >&2; exit 4; }
fi

# ---- report ----------------------------------------------------------------
pass=0; fail=0
while read -r rc name; do
  [ -n "${name:-}" ] || continue
  if [ "$rc" = 0 ]; then
    pass=$((pass + 1))
    printf 'PASS %s\n' "$name"
  else
    fail=$((fail + 1))
    reason=$(grep -m1 -E 'error|warning|fatal|bad_alloc|cannot' "$LOGS/$name.log" 2>/dev/null | sed 's/^[[:space:]]*//')
    [ -n "$reason" ] || reason="compiler exited $rc"
    mi=$(missing_includes "$SRC/$name")
    printf 'FAIL %s: %s\n' "$name" "$reason"
    [ -n "$mi" ] && printf '     missing include(s): %s\n' "$mi"
  fi
done < "$OUT/.status"
rm -f "$OUT/.status"

echo
echo "compiled: $pass   failed: $fail   output: $OUT"
[ "$fail" -eq 0 ] || exit 1
