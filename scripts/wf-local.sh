#!/usr/bin/env bash
# scripts/wf-local.sh - run the whole FreeNova Winterfest update on this machine.
#
# One command, one tree, one port, one log:
#
#   bash scripts/wf-local.sh start      # build the tree, boot the game server, start the panel
#   bash scripts/wf-local.sh smoke      # boot fresh and assert the Winterfest boot contract
#   bash scripts/wf-local.sh status     # what is running, on which port, where the logs are
#   bash scripts/wf-local.sh logs       # tail the game console
#   bash scripts/wf-local.sh stop       # stop both, saving player state
#   bash scripts/wf-local.sh reset      # drop the local vaults + the panel DB copy
#   bash scripts/wf-local.sh url        # the connect string and panel links
#
# Nothing here touches a live host, the shared harness tree (cs16-linux-base's
# build/server-freenova) or the repo's own game-server/**/plugins.ini. Everything
# lives under build/wf-local/ (gitignored), listens on its own port (27016) and
# writes its own logs.
#
# The design notes, the ports and the known limits: docs/WINTERFEST-LOCAL.md.
#
# Environment overrides (all optional):
#   WF_PORT=27016           game port
#   WF_PANEL_PORT=18101     panel port
#   WF_MAP=de_dust2         boot map
#   WF_MAXPLAYERS=16
#   WF_PANEL_HOST=127.0.0.1 panel bind address
#   WF_IMAGE=cs16-base:1.10 container image the runtime assembled
#   WF_CONTAINER=wf-local-<port>
#   WF_TREE=build/wf-local/server     the HLDS tree (a second instance needs its own)
#   WF_TZ=Europe/Paris      clock inside the game container (the date gates read it)
#   WF_KEEP_WINDOW=1        do not widen the season windows in the copied configs
#   WF_SYNC=1               also point the game server's stats sync at the local panel
#   CS16_RUNTIME=/home/ajxs/Desktop/Projects/cs16/cs16-linux-base
#   WF_SOURCE_TREE=$CS16_RUNTIME/build/server-freenova   (copy source; never used in place)

set -uo pipefail

# ---------------------------------------------------------------------------
# Paths and settings
# ---------------------------------------------------------------------------
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WF="$ROOT/build/wf-local"
TREE=${WF_TREE:-$WF/server}       # the HLDS tree (mounted at /server)
RUN="$WF/run"                     # fifo, pids, the smoke log
LOG="$WF/server.log"
PANEL_DIR="$WF/panel"
PANEL_DB="$PANEL_DIR/freenova_panel.sq3"
PANEL_LOG="$PANEL_DIR/panel.log"

LIVE_DB="$ROOT/web-panel/data/freenova_panel.sq3"
PANEL_ENTRY="$ROOT/web-panel/server_local.mjs"
REPO_AMXX="$ROOT/game-server/cstrike/addons/amxmodx"
REPO_WF_CFG="$REPO_AMXX/configs/freenova"

RUNTIME=${CS16_RUNTIME:-/home/ajxs/Desktop/Projects/cs16/cs16-linux-base}
SOURCE_TREE=${WF_SOURCE_TREE:-$RUNTIME/build/server-freenova}

PORT=${WF_PORT:-27016}
PANEL_PORT=${WF_PANEL_PORT:-18101}
PANEL_HOST=${WF_PANEL_HOST:-127.0.0.1}
MAP=${WF_MAP:-de_dust2}
MAXPLAYERS=${WF_MAXPLAYERS:-16}
IMAGE=${WF_IMAGE:-cs16-base:1.10}
NAME=${WF_CONTAINER:-wf-local-$PORT}
TZ_NAME=${WF_TZ:-Europe/Paris}

FIFO="$RUN/hlds.in"
GAME_PID="$RUN/game.pid"
HOLDER_PID="$RUN/holder.pid"
PANEL_PID="$RUN/panel.pid"
PLUGIN_LIST="$RUN/winterfest-plugins.txt"

BOOT_TIMEOUT=${WF_BOOT_TIMEOUT:-150}

# Load order, from docs/WINTERFEST-DEV.md section 2.1: the core first, then the
# module that draws presents (menu asks LibraryExists("winterfest_gifts")), then
# the menu. The optional modules come after, because every one of them either
# calls a core native or pauses itself when the core is missing.
WF_CORE_PLUGINS=(winterfest_core winterfest_gifts winterfest_menu)
WF_OPTIONAL_PLUGINS=(
  winterfest_atmos winterfest_killfeed winterfest_snow winterfest_reindeer
  winterfest_spin winterfest_progress winterfest_mail winterfest_cosmetics
)

# The test window the copied configs are widened to (WF_KEEP_WINDOW=1 skips it).
WF_TEST_START="2000-01-01 00:00"
WF_TEST_END="2099-12-31 23:59"

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
note() { printf '     %s\n' "$*"; }
warn() { printf '\033[1;33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merr\033[0m %s\n' "$*" >&2; exit 1; }

if [ -t 1 ]; then _green=$'\033[1;32m'; _red=$'\033[1;31m'; _reset=$'\033[0m'
else _green=""; _red=""; _reset=""; fi

have() { command -v "$1" >/dev/null 2>&1; }

port_taken_udp() { ss -lunH 2>/dev/null | awk '{print $4}' | grep -q ":${1}$"; }
port_taken_tcp() { ss -ltnH 2>/dev/null | awk '{print $4}' | grep -q ":${1}$"; }

panel_up() {
  local code
  code=$(http_code "http://$PANEL_HOST:$PANEL_PORT/")
  case "$code" in 2*|3*|4*) return 0 ;; esac
  return 1
}

# The pid listening on the panel port, if `ss -p` can see it (same user).
panel_pid_on_port() {
  ss -ltnpH 2>/dev/null | grep -E ":${PANEL_PORT} " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

# Is that pid *our* panel? Its environment carries PANEL_DB=<our copy>, which no
# other process on this box has. This is what keeps `stop` from ever killing a
# panel another agent (or the live stack) is running.
panel_pid_is_ours() {
  local p=${1:-}
  [ -n "$p" ] || return 1
  [ -r "/proc/$p/environ" ] || return 1
  tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qxF "PANEL_DB=$PANEL_DB"
}

http_code() { # http_code <url> -> the status code, 000 when nothing answers
  local url=$1 code=""
  if have curl; then
    code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$url" 2>/dev/null) || true
  elif have node; then
    code=$(node -e '
      const u = process.argv[1]
      fetch(u, { signal: AbortSignal.timeout(3000) })
        .then(r => console.log(r.status)).catch(() => console.log("000"))
    ' "$url" 2>/dev/null) || true
  fi
  case "$code" in
    [1-9][0-9][0-9]) printf '%s' "$code" ;;
    *) printf '000' ;;
  esac
}

container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ]
}

game_running() { container_running || pid_alive "$GAME_PID"; }

pid_alive() {
  local f=$1
  [ -f "$f" ] || return 1
  local p
  p=$(cat "$f" 2>/dev/null) || return 1
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

# ini_set <file> <section> <key=value> [<key=value> ...]
# Rewrites `key = value` lines inside one [section]; comments, other sections and
# unknown keys are left exactly as they are. A key it could not find is reported
# (a silent no-op would leave the season closed and look like a plugin bug).
ini_set() {
  local file=$1 section=$2
  shift 2
  [ -f "$file" ] || { warn "ini_set: no such file $file"; return 1; }
  local kvfile
  kvfile=$(mktemp) || return 1
  printf '%s\n' "$@" > "$kvfile"
  awk -v section="$section" -v kvfile="$kvfile" '
    BEGIN {
      while ((getline line < kvfile) > 0) {
        eq = index(line, "=")
        if (eq < 2) continue
        k = substr(line, 1, eq - 1)
        key[++nk] = k
        val[k] = substr(line, eq + 1)
      }
      close(kvfile)
    }
    {
      line = $0
      if (line ~ /^[ \t]*\[/) {
        cur = line
        gsub(/[\][ \t]/, "", cur)
      }
      if (cur == section) {
        k = line
        sub(/^[ \t]*/, "", k)
        if (k ~ /=/) {
          k = substr(k, 1, index(k, "=") - 1)
          sub(/[ \t]+$/, "", k)
          if (k in val) { line = k " = " val[k]; seen[k] = 1 }
        }
      }
      print line
    }
    END {
      for (i = 1; i <= nk; i++)
        if (!seen[key[i]]) print key[i] > "/dev/stderr"
    }
  ' "$file" > "$file.wfnew" 2>"$file.wferr"
  mv -f "$file.wfnew" "$file"
  local missing
  missing=$(tr '\n' ' ' < "$file.wferr" 2>/dev/null)
  rm -f "$file.wferr" "$kvfile"
  if [ -n "$missing" ]; then
    warn "$(basename "$file"): [${section}] has no $(printf '%s' "$missing")key - left as is"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# 1. The tree
# ---------------------------------------------------------------------------
# A usable tree means: the engine, the AMXX binary module, the vanilla player
# model (the engine dies without it) and at least one map.
tree_ok() {
  [ -x "$TREE/hlds_linux" ] \
    && [ -f "$TREE/cstrike/addons/amxmodx/dlls/amxmodx_mm_i386.so" ] \
    && [ -f "$TREE/cstrike/models/player.mdl" ] \
    && [ -f "$TREE/cstrike/maps/$MAP.bsp" ]
}

# The bulk of a full tree is 2.4 GB of Valve content that a running server only
# ever reads. Those directories are hard-linked from the assembled profile tree
# (a few hundred inodes instead of a 2.4 GB copy, and an edit in one tree can
# never reach the other because every file we touch is a real copy).
HARDLINK_DIRS=(maps models sound sprites gfx resource overviews)

# Hard-link a directory tree when the two live on the same filesystem (a few
# hundred inodes instead of 2.4 GB), and fall back to a real copy when they do
# not - a cross-device hard link is an error, and a partial tree is worse than a
# slow one.
clone_dir() { # clone_dir <src> <dst>
  local src=$1 dst=$2
  rm -rf "$dst"
  if cp -al "$src" "$dst" 2>/dev/null; then
    return 0
  fi
  warn "${src#$ROOT/} -> ${dst#$ROOT/}: not the same filesystem, copying instead of hard-linking"
  rm -rf "$dst"
  cp -a "$src" "$dst"
}

copy_tree() {
  say "copying the freenova profile tree from $SOURCE_TREE"
  rm -rf "$TREE"
  mkdir -p "$TREE"

  cp -a "$SOURCE_TREE"/*.so "$SOURCE_TREE"/hlds_linux "$SOURCE_TREE"/hltv \
        "$SOURCE_TREE"/steam_appid.txt "$TREE"/ 2>/dev/null
  [ -f "$SOURCE_TREE/BUILD-INFO.txt" ] && cp -f "$SOURCE_TREE/BUILD-INFO.txt" "$TREE/"

  [ -d "$SOURCE_TREE/valve" ] && clone_dir "$SOURCE_TREE/valve" "$TREE/valve"

  mkdir -p "$TREE/cstrike"
  local d f
  for d in "${HARDLINK_DIRS[@]}"; do
    [ -d "$SOURCE_TREE/cstrike/$d" ] && clone_dir "$SOURCE_TREE/cstrike/$d" "$TREE/cstrike/$d"
  done
  # Everything else in cstrike/ (addons, wads, cfgs) is a real copy: plugins.ini,
  # the configs and the vault files are written here.
  ( cd "$SOURCE_TREE/cstrike" || exit 1
    for f in *; do
      case " ${HARDLINK_DIRS[*]} " in *" $f "*) continue ;; esac
      cp -a "$f" "$TREE/cstrike/"
    done ) || return 1

  # The engine and AMXX both write here; a missing directory is a hard failure
  # (AMXX disables its logging for the whole map).
  mkdir -p "$TREE/cstrike/addons/amxmodx/logs" \
           "$TREE/cstrike/addons/amxmodx/data/vault" \
           "$TREE/cstrike/logs"

  # A fresh season: the profile snapshot carries whatever the last harness run
  # left in its vault, and a copied Winterfest record would make "fresh test"
  # a lie.
  rm -f "$TREE/cstrike/addons/amxmodx/data/vault/freenova_wf.vault" \
        "$TREE/cstrike/addons/amxmodx/data/vault/freenova_wf"*.journal \
        "$TREE/cstrike/addons/amxmodx/data/vault/freenova_wfprog.vault" \
        "$TREE/cstrike/addons/amxmodx/data/vault/freenova_wfm.vault" \
        "$TREE/cstrike/addons/amxmodx/data/vault/freenova_wfspin.vault"
}

ensure_tree() {
  local force=${1:-0}
  if [ "$force" != 1 ] && tree_ok; then
    return 0
  fi
  [ -d "$SOURCE_TREE/cstrike/addons" ] || die "no assembled profile tree at $SOURCE_TREE
     Build it once with:
       cd $RUNTIME && ./scripts/assemble.sh --profile freenova
     then run this script again (or set WF_SOURCE_TREE to another assembled tree).
     This script only *copies* it; it never assembles into or boots from it."
  copy_tree || die "copy from $SOURCE_TREE failed"
  if ! tree_ok; then
    warn "the copied tree is incomplete (the source may have been mid-assembly); retrying once"
    sleep 2
    copy_tree || die "copy from $SOURCE_TREE failed again"
    tree_ok || die "the copied tree is still incomplete - re-run: cd $RUNTIME && ./scripts/assemble.sh --profile freenova"
  fi
  ok "tree at $TREE ($(du -sh "$TREE" 2>/dev/null | cut -f1) apparent, hard-linked content)"
}

# ---------------------------------------------------------------------------
# 2. Winterfest: plugins, configs, switches
# ---------------------------------------------------------------------------
sync_plugins() {
  local plugins_dir="$TREE/cstrike/addons/amxmodx/plugins"
  local ini="$TREE/cstrike/addons/amxmodx/configs/plugins.ini"
  mkdir -p "$plugins_dir" "$(dirname "$ini")" "$RUN"

  local installed=() missing=() refreshed=() name src
  for name in "${WF_CORE_PLUGINS[@]}" "${WF_OPTIONAL_PLUGINS[@]}"; do
    src="$REPO_AMXX/plugins/$name.amxx"
    if [ -f "$src" ]; then
      cp -f "$src" "$plugins_dir/$name.amxx"
      installed+=("$name")
    else
      # Never leave a stale build of a plugin the repo no longer has.
      rm -f "$plugins_dir/$name.amxx"
      missing+=("$name")
    fi
  done

  # Rewrite the list from scratch: drop any Winterfest/zz_test line a previous run
  # (or another process that borrowed this tree) left behind, then append ours.
  # Both `winterfest_core.amxx` and a bare `winterfest_core` are matched - a bare
  # name is not a file AMXX can open, so it must not survive a re-sync.
  if [ -f "$ini" ]; then
    sed -i -E '/^[[:space:]]*[Ww]interfest_[A-Za-z0-9_.]*(\.amxx)?([[:space:]]|;|$)/d' "$ini"
    sed -i -E '/^[[:space:]]*zz_test_[A-Za-z0-9_.]*(\.amxx)?([[:space:]]|;|$)/d' "$ini"
    sed -i -E '/^[[:space:]]*;+.*[Ww]interfest/d' "$ini"
  else
    : > "$ini"
  fi
  {
    printf '\n; --- Winterfest (local test tree, scripts/wf-local.sh) ---\n'
    local p
    for p in "${installed[@]}"; do printf '%s.amxx\n' "$p"; done
    # An extra probe/driver plugin for one session:
    #   WF_EXTRA_PLUGINS="zz_test_matrix" bash scripts/wf-local.sh restart
    # Its .amxx must already be in the repo's plugins/ directory (they are
    # gitignored there). Appended after the Winterfest block on purpose - a
    # probe that needs the core must load after it.
    local extra
    for extra in ${WF_EXTRA_PLUGINS:-}; do
      local src="$REPO_AMXX/plugins/$extra.amxx"
      if [ -f "$src" ]; then
        cp -f "$src" "$plugins_dir/$extra.amxx"
        printf '%s.amxx\n' "$extra"
        # note() writes to STDOUT and this block is redirected into plugins.ini:
        # four boots ago it printed human text straight into the plugin list,
        # which AMXX then reported as `bad load: Plugin file open error (plugin
        # "extra")`. Report on stderr instead.
        note "extra plugin for this session: $extra.amxx" >&2
      else
        warn "WF_EXTRA_PLUGINS names $extra but $REPO_AMXX/plugins/$extra.amxx is missing - skipped"
      fi
    done
  } >> "$ini"
  printf '%s\n' "${installed[@]}" > "$PLUGIN_LIST"

  ok "${#installed[@]} Winterfest plugin(s) in $ini: ${installed[*]}"
  if [ "${#missing[@]}" -gt 0 ]; then
    warn "not built yet, so not loaded: ${missing[*]}"
    note "(a missing module is skipped, never fatal - the core and the rest still load)"
  fi
  # The copied tree carries ITS OWN builds of the core FreeNova plugins (the
  # harness image ships them). A tree build older than a plugin this repo just
  # changed is a silent failure: AMXX loads the stale binary, the console says
  # `bad load` or the behaviour stays wrong while the log looks healthy. Only the
  # plugins this repo actually rebuilt are refreshed, and only when this repo's
  # own plugins/ directory holds them.
  local p src
  for p in freenova_panel freenova_sync; do
    src="$REPO_AMXX/plugins/$p.amxx"
    if [ -f "$src" ]; then
      cp -f "$src" "$plugins_dir/$p.amxx"
      refreshed+=("$p")
    fi
  done
  if [ "${#refreshed[@]}" -gt 0 ]; then
    note "refreshed from this repo: ${refreshed[*]}"
  fi

  if [ ! -f "$plugins_dir/winterfest_core.amxx" ]; then
    warn "winterfest_core.amxx is missing: every other module will pause itself (LibraryExists)"
  fi
}

sync_configs() {
  local dst="$TREE/cstrike/addons/amxmodx/configs/freenova"
  mkdir -p "$dst/winterfest"

  [ -f "$REPO_WF_CFG/winterfest.ini" ] || die "no config at $REPO_WF_CFG/winterfest.ini"
  cp -f "$REPO_WF_CFG/winterfest.ini" "$dst/winterfest.ini"

  # The content pack: spin.ini, progress.ini, atmos.ini, killfeed.ini, modes.ini,
  # missions.ini, achievements.ini, cosmetics.ini are each read by their own
  # module straight out of this directory (the core only reads winterfest.ini).
  rm -rf "$dst/winterfest"
  mkdir -p "$dst/winterfest"
  if [ -d "$REPO_WF_CFG/winterfest" ]; then
    cp -a "$REPO_WF_CFG/winterfest/." "$dst/winterfest/"
    ok "configs: winterfest.ini + $(ls "$dst/winterfest" | wc -l) file(s) in freenova/winterfest/"
  else
    warn "no content pack at $REPO_WF_CFG/winterfest/ - modules that read it use built-in defaults"
  fi

  # epoch the copy so nobody mistakes it for the shipped config
  local stamp="; wf-local test copy ($(date '+%Y-%m-%d %H:%M')) - scripts/wf-local.sh, never deployed"
  sed -i "1s|^|$stamp\n|" "$dst/winterfest.ini"

  if [ "${WF_KEEP_WINDOW:-0}" = "1" ]; then
    note "season windows left as shipped (WF_KEEP_WINDOW=1); wf_force_open/wf_atmos_force drive the modules"
    return 0
  fi

  # The season is a date window and today is not December. Three modules keep
  # their own window in their own file, so widening only the core's would leave
  # presents spawned, atmos idle and progress dormant.
  ini_set "$dst/winterfest.ini" season \
      "enabled=1" "start=$WF_TEST_START" "end=$WF_TEST_END" "advent_end=$WF_TEST_END" \
      && note "winterfest.ini  [season] window widened to $WF_TEST_START .. $WF_TEST_END"
  ini_set "$dst/winterfest/progress.ini" season \
      "start=$WF_TEST_START" "end=$WF_TEST_END" \
      && note "progress.ini    [season] window widened to $WF_TEST_START .. $WF_TEST_END"
  ini_set "$dst/winterfest/atmos.ini" season "start=01-01" "end=12-31" \
      && note "atmos.ini       [season] window 01-01 .. 12-31 (killfeed reads the same window)"
}

write_switches() {
  local cfg="$TREE/cstrike/wf-local.cfg"
  local sync_on=${WF_SYNC:-0}
  cat > "$cfg" <<EOF
// scripts/wf-local.sh - the LOCAL Winterfest stack (127.0.0.1:$PORT).
// Generated on every start; lives only in build/wf-local/server. Never deployed.
hostname "FreeNova | Winterfest LOCAL (127.0.0.1:$PORT)"
sv_lan 1
sv_password ""
rcon_password "wflocal"
// No fastdl here: the live mirror is not touched and the client falls back to
// downloading from this game port (see docs/WINTERFEST-LOCAL.md, known limits).
sv_downloadurl ""
sv_allowdownload 1
sv_allowupload 0
sv_maxrate 0
sv_minrate 0
// Winterfest switches. The copied configs already open the window; these are the
// cvar path an operator would use on a real host, so the local box exercises it.
wf_enabled 1
wf_force_open 1
wf_atmos 1
wf_atmos_force 1
wf_killfeed 1
wf_killfeed_force 1
wf_snow 1
wf_bombfx 1
// The present model (models/winterfest/present.mdl) is in this tree from the
// content pack. Leaving this at 0 was the whole of the "presents are a glow"
// report: the cvar gates every model prop, and nothing on the local stack set
// it. 1 = draw the model, 0 = the glow fallback (one-line revert).
wf_allow_models 1
wf_panel_url "http://$PANEL_HOST:$PANEL_PORT/winter"
mp_timelimit 0
mp_maxrounds 0
EOF
  if [ "$sync_on" = "1" ]; then
    cat >> "$cfg" <<EOF
// Panel sync pointed at the local panel (WF_SYNC=1). The local panel keeps its
// own copy of the DB, so nothing reaches the live one.
fnweb_enabled 1
fnweb_host "$PANEL_HOST"
fnweb_port "$PANEL_PORT"
fnweb_url "http://$PANEL_HOST:$PANEL_PORT"
fnweb_public_host "$PANEL_HOST:$PANEL_PORT"
EOF
  else
    cat >> "$cfg" <<EOF
// Stats sync stays off (the freenova profile's cs16-test.cfg turns it off for
// every local boot; WF_SYNC=1 turns it on against the local panel only).
fnweb_enabled 0
fnweb_secret ""
EOF
  fi

  # An operator's live switch beats the generated file, so `wf_allow_models 0`
  # typed on the console survives until the next boot. Written AFTER the
  # generated keys so cvars.cfg (exec'd from here, last) wins over them.
  cat >> "$cfg" <<EOF
// An operator's own overrides, re-applied last on every boot. Edit freely; this
// file is regenerated, not owned.
exec wf-local-operator.cfg
EOF
  if [ ! -f "$TREE/cstrike/wf-local-operator.cfg" ]; then
    printf '%s\n' "// wf-local operator overrides (applied last on every boot)" > "$TREE/cstrike/wf-local-operator.cfg"
  fi

  local test_cfg="$TREE/cstrike/cs16-test.cfg"
  if [ -f "$test_cfg" ] && ! grep -q 'exec wf-local.cfg' "$test_cfg"; then
    printf '\n// scripts/wf-local.sh overrides (loaded last)\nexec wf-local.cfg\n' >> "$test_cfg"
  fi
  ok "switches in cstrike/wf-local.cfg (exec'd last by cs16-test.cfg)"
}

sync_winterfest() {
  say "syncing Winterfest into the local tree"
  [ -d "$TREE/cstrike/addons/amxmodx" ] || die "tree is not assembled - run: bash scripts/wf-local.sh build"
  # Another process in this workspace (or a root-run container) can leave log and
  # vault files this user cannot append to; AMXX then disables its logging for the
  # whole map. Only the two directories this script owns are touched.
  local d f unwritable=0
  for d in "$TREE/cstrike/addons/amxmodx/logs" "$TREE/cstrike/addons/amxmodx/data/vault"; do
    mkdir -p "$d"
    for f in "$d"/*; do
      [ -e "$f" ] || continue
      [ -w "$f" ] || { rm -f "$f" 2>/dev/null && unwritable=$((unwritable + 1)); }
    done
  done
  [ "$unwritable" -gt 0 ] && note "cleared $unwritable file(s) in logs/vault that this user could not write (left by another run)"
  sync_plugins
  sync_configs
  write_switches
}

# ---------------------------------------------------------------------------
# 3. The game server
# ---------------------------------------------------------------------------
boot_game() {
  mkdir -p "$RUN"
  if game_running; then
    warn "the game server is already running (container $NAME) - stop it first: bash scripts/wf-local.sh stop"
    return 0
  fi
  if port_taken_udp "$PORT"; then
    local holder
    holder=$(ss -lunpH 2>/dev/null | awk -v p=":$PORT" '$4 ~ p "$" {print $0}' | head -1)
    warn "UDP $PORT is already in use:"
    [ -n "$holder" ] && printf '       %s\n' "$holder" >&2
    local other
    other=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E ":$PORT->" | head -1)
    [ -n "$other" ] && printf '       (docker container: %s)\n' "$other" >&2
    die "not touching it. Stop that server, or pick another port:
       WF_PORT=27017 bash scripts/wf-local.sh start"
  fi
  have docker || die "docker is not available"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "container image $IMAGE not found
     Build it once in the runtime: cd $RUNTIME && ./scripts/setup.sh   (or make image)"

  # A previous run whose docker client was killed can leave a *stopped* container
  # behind holding the name (docker's --rm cleanup is done by the client). Remove
  # that shell so `docker run` is never refused for a conflict.
  if docker inspect "$NAME" >/dev/null 2>&1 && ! container_running; then
    note "removing the leftover container $NAME from an earlier run"
    docker rm -f "$NAME" >/dev/null 2>&1
  fi

  # rotate, then mark, so status/smoke can scope to this boot
  [ -f "$LOG" ] && mv -f "$LOG" "$LOG.1"
  : > "$LOG"
  printf '=== wf-local start %s (port %s, map %s) ===\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$PORT" "$MAP" >> "$LOG"

  rm -f "$FIFO"
  mkfifo "$FIFO"

  # The console is a FIFO, exactly like the shared harness does it: `cmd` writes
  # a line, HLDS reads it. The holder keeps a writer open so a write never lands
  # on EOF, and `quit` is a graceful shutdown (AMXX runs plugin_end and saves).
  setsid docker run --rm -i --name "$NAME" --network host \
      --user "$(id -u):$(id -g)" -e HOME=/tmp -e "TZ=$TZ_NAME" \
      -v "$TREE:/server" "$IMAGE" \
      boot --map "$MAP" --port "$PORT" --maxplayers "$MAXPLAYERS" \
      < "$FIFO" >> "$LOG" 2>&1 &
  echo $! > "$GAME_PID"

  setsid sh -c "exec sleep 86400 > '$FIFO'" >/dev/null 2>&1 &
  echo $! > "$HOLDER_PID"

  say "booting $MAP on UDP $PORT (container $NAME) - log: ${LOG#$ROOT/}"
}

wait_for_boot() {
  local timeout=${1:-$BOOT_TIMEOUT} i=0 limit=$(( ${1:-$BOOT_TIMEOUT} * 4 ))
  printf '     waiting for Round_Start'
  while [ "$i" -lt "$limit" ]; do
    if grep -qF 'World triggered "Round_Start"' "$LOG" 2>/dev/null; then
      printf '\n'; return 0
    fi
    if ! game_running; then
      printf '\n'; return 2
    fi
    printf '.'; sleep 0.25; i=$((i + 1))
  done
  printf '\n'
  return 1
}

send_cmd() {
  game_running || die "the game server is not running - bash scripts/wf-local.sh start"
  try_cmd "$@" || die "could not write to the console fifo (no reader - is the server up?)"
}

try_cmd() {
  [ -p "$FIFO" ] || return 1
  # One console line per argument, order preserved. "$*" joined them with
  # spaces, so `cmd wf_give X gingerbread 0 10` reached the server as four
  # separate commands and only the first one quoted its own argument.
  local a rc=0
  for a in "$@"; do
    printf '%s\n' "$a" > "$FIFO" 2>/dev/null || rc=1
  done
  return $rc
}

stop_game() {
  local quiet=${1:-0}
  if ! game_running; then
    [ "$quiet" = 1 ] || note "game server is not running"
  else
    [ "$quiet" = 1 ] || say "stopping the game server (quit, then SIGTERM after 10s)"
    try_cmd 'quit' || true
    local i=0
    while [ "$i" -lt 40 ] && container_running; do sleep 0.25; i=$((i + 1)); done
    container_running && docker stop -t 5 "$NAME" >/dev/null 2>&1
    # Let the docker client exit on its own (it is what removes the container);
    # only kill it if it hangs, and force the container away afterwards so the
    # name is free for the next boot.
    i=0
    while [ "$i" -lt 20 ] && pid_alive "$GAME_PID"; do sleep 0.25; i=$((i + 1)); done
    pid_alive "$GAME_PID" && kill -TERM "$(cat "$GAME_PID")" 2>/dev/null
    sleep 0.3
    docker inspect "$NAME" >/dev/null 2>&1 && docker rm -f "$NAME" >/dev/null 2>&1
  fi
  pid_alive "$HOLDER_PID" && kill -TERM "$(cat "$HOLDER_PID")" 2>/dev/null
  rm -f "$FIFO" "$GAME_PID" "$HOLDER_PID"
  return 0
}

# ---------------------------------------------------------------------------
# 4. The panel
# ---------------------------------------------------------------------------
copy_panel_db() {
  mkdir -p "$PANEL_DIR"
  [ -f "$LIVE_DB" ] || { warn "no live panel DB at ${LIVE_DB#$ROOT/} - the panel will start empty"; return 1; }
  rm -f "$PANEL_DB" "$PANEL_DB-wal" "$PANEL_DB-shm"
  say "copying the live panel DB (${LIVE_DB#$ROOT/} -> ${PANEL_DB#$ROOT/})"
  if have sqlite3; then
    local try
    for try in 1 2 3; do
      if sqlite3 "$LIVE_DB" ".backup '$PANEL_DB'" >/dev/null 2>&1 && [ -s "$PANEL_DB" ]; then
        ok "panel DB copy ($(du -h "$PANEL_DB" | cut -f1))"
        return 0
      fi
      sleep 1
    done
    warn "sqlite3 .backup failed (busy?); falling back to a file copy"
  fi
  cp -f "$LIVE_DB" "$PANEL_DB" || return 1
  [ -f "$LIVE_DB-wal" ] && cp -f "$LIVE_DB-wal" "$PANEL_DB-wal"
  [ -f "$LIVE_DB-shm" ] && cp -f "$LIVE_DB-shm" "$PANEL_DB-shm"
  ok "panel DB copy ($(du -h "$PANEL_DB" | cut -f1))"
}

start_panel() {
  have node || die "node is not available (the panel is a Node HTTP server)"
  mkdir -p "$PANEL_DIR"
  [ -f "$PANEL_DB" ] || copy_panel_db || true

  if panel_up; then
    local live_pid
    live_pid=$(panel_pid_on_port)
    if panel_pid_is_ours "$live_pid"; then
      echo "$live_pid" > "$PANEL_PID"
      note "the panel is already up on http://$PANEL_HOST:$PANEL_PORT/ (pid $live_pid)"
      return 0
    fi
    die "TCP $PANEL_PORT answers, but this script did not start that process.
     (Another agent or a leftover dev panel owns the port.) Options:
       bash scripts/wf-local.sh stop
       WF_PANEL_PORT=18102 bash scripts/wf-local.sh start"
  fi
  if port_taken_tcp "$PANEL_PORT"; then
    die "TCP $PANEL_PORT is already in use by another process - not touching it.
     Pick another port: WF_PANEL_PORT=18102 bash scripts/wf-local.sh start"
  fi

  printf '\n=== wf-local panel start %s (port %s) ===\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$PANEL_PORT" >> "$PANEL_LOG"
  # Own session (so the harness that started this script cannot reap it), and the
  # pid file is written by the shell that execs node, so it holds node's own pid.
  # DISCORD_WEBHOOK_URL is blanked on purpose: relay/relay.env carries the live
  # webhook, and a local "call admin" must not ring the real Discord channel.
  setsid sh -c '
    echo $$ > "$1"
    exec env PORT="$2" HOST="$3" PANEL_DB="$4" FN_PUBLIC_ADDR="$5" \
      DISCORD_WEBHOOK_URL= node "$6"
  ' _ "$PANEL_PID" "$PANEL_PORT" "$PANEL_HOST" "$PANEL_DB" \
      "$PANEL_HOST:$PORT" "$PANEL_ENTRY" >> "$PANEL_LOG" 2>&1 &

  local i=0 pid_on_port
  while [ "$i" -lt 60 ]; do
    if panel_up; then
      # The listener's pid is the only authoritative handle (a wrapper shell may
      # have forked); prefer it over the one we wrote.
      pid_on_port=$(ss -ltnpH 2>/dev/null | grep -E ":$PANEL_PORT " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
      [ -n "$pid_on_port" ] && echo "$pid_on_port" > "$PANEL_PID"
      ok "panel on http://$PANEL_HOST:$PANEL_PORT/ (pid $(cat "$PANEL_PID" 2>/dev/null), log: ${PANEL_LOG#$ROOT/})"
      return 0
    fi
    pid_alive "$PANEL_PID" || break
    sleep 0.25; i=$((i + 1))
  done
  warn "the panel did not answer on port $PANEL_PORT - last lines of ${PANEL_LOG#$ROOT/}:"
  tail -15 "$PANEL_LOG" 2>/dev/null | sed 's/^/       /' >&2
  return 1
}

stop_panel() {
  local quiet=${1:-0} pids=() p
  if pid_alive "$PANEL_PID"; then pids+=("$(cat "$PANEL_PID")"); fi
  p=$(panel_pid_on_port); [ -n "$p" ] && pids+=("$p")

  local killed=0 pid
  for pid in "${pids[@]+"${pids[@]}"}"; do
    # Only ever a panel that carries our PANEL_DB, and only once.
    panel_pid_is_ours "$pid" || continue
    [ "$quiet" = 1 ] || say "stopping the panel (pid $pid)"
    kill -TERM "$pid" 2>/dev/null
    local i=0
    while [ "$i" -lt 20 ] && kill -0 "$pid" 2>/dev/null; do sleep 0.2; i=$((i + 1)); done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    killed=1
    break
  done
  [ "$killed" = 1 ] || { [ "$quiet" = 1 ] || note "the panel is not running"; }
  rm -f "$PANEL_PID"
  if panel_up; then
    warn "something still answers on http://$PANEL_HOST:$PANEL_PORT/ - that process was not started by this script, so it is left alone"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# 5. Commands
# ---------------------------------------------------------------------------
cmd_build() {
  local force=0
  [ "${1:-}" = "--force" ] && force=1
  have docker || die "docker is not available"
  ensure_tree "$force"
  sync_winterfest
  ok "tree ready: bash scripts/wf-local.sh start"
}

cmd_sync() {
  ensure_tree 0
  sync_winterfest
  ok "re-synced - a running server picks the .amxx up on: bash scripts/wf-local.sh reload <plugin>"
}

cmd_start() {
  ensure_tree 0
  sync_winterfest
  boot_game
  local rc=0
  wait_for_boot "$BOOT_TIMEOUT" || rc=$?
  if [ "$rc" -eq 2 ]; then
    warn "the game server exited during boot - last 30 lines of ${LOG#$ROOT/}:"
    tail -30 "$LOG" | sed 's/^/       /' >&2
    stop_game 0
    return 1
  elif [ "$rc" -ne 0 ]; then
    warn "no Round_Start within ${BOOT_TIMEOUT}s - last 30 lines of ${LOG#$ROOT/}:"
    tail -30 "$LOG" | sed 's/^/       /' >&2
    return 1
  fi
  ok "game server up: $MAP on UDP $PORT"

  ( start_panel ) || warn "the game server is up; the panel is not"
  echo
  cmd_url
}

cmd_stop() {
  stop_game 0
  stop_panel 0
  ok "stopped"
}

cmd_status() {
  printf '%-22s %s\n' "tree"        "$TREE"
  if tree_ok; then
    printf '%-22s %s\n' "" "${_green}complete${_reset} ($(du -sh "$TREE" 2>/dev/null | cut -f1) apparent)"
  else
    printf '%-22s %s\n' "" "not built yet (bash scripts/wf-local.sh start)"
  fi
  if [ -f "$PLUGIN_LIST" ]; then
    printf '%-22s %s\n' "winterfest plugins" "$(tr '\n' ' ' < "$PLUGIN_LIST")"
  fi

  if game_running; then
    printf '%-22s %s\n' "game server" "running  udp/$PORT  container $NAME"
  elif port_taken_udp "$PORT"; then
    printf '%-22s %s\n' "game server" "not ours - udp/$PORT is held by another process"
  else
    printf '%-22s %s\n' "game server" "stopped"
  fi
  printf '%-22s %s\n' "game log"    "${LOG#$ROOT/}$( [ -f "$LOG" ] && printf ' (%s lines)' "$(wc -l < "$LOG")")"

  local live_panel
  live_panel=$(panel_pid_on_port)
  if panel_pid_is_ours "$live_panel" && panel_up; then
    printf '%-22s %s\n' "panel" "running  http://$PANEL_HOST:$PANEL_PORT/ (pid $live_panel)"
  elif panel_pid_is_ours "$live_panel"; then
    printf '%-22s %s\n' "panel" "process up (pid $live_panel), not answering on $PANEL_PORT yet"
  elif panel_up; then
    printf '%-22s %s\n' "panel" "not ours - tcp/$PANEL_PORT answers (another process)"
  else
    printf '%-22s %s\n' "panel" "stopped"
  fi
  printf '%-22s %s\n' "panel log"   "${PANEL_LOG#$ROOT/}"
  printf '%-22s %s\n' "panel DB copy" "${PANEL_DB#$ROOT/}$( [ -f "$PANEL_DB" ] && printf ' (%s)' "$(du -h "$PANEL_DB" | cut -f1)")"

  if [ -f "$LOG" ]; then
    echo
    printf 'last log lines:\n'
    tail -5 "$LOG" | sed 's/^/  /'
  fi
}

cmd_logs() {
  local target=server n=40 follow=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      server|game|panel|amxx) target=$1 ;;
      -f|--follow) follow=1 ;;
      -n) n=${2:-40}; shift ;;
      *) n=$1 ;;
    esac
    shift
  done
  case "$target" in
    server|game)
      [ -f "$LOG" ] || die "no log yet at ${LOG#$ROOT/}"
      [ "$follow" = 1 ] && exec tail -n "$n" -f "$LOG"
      tail -n "$n" "$LOG" ;;
    panel)
      [ -f "$PANEL_LOG" ] || die "no log yet at ${PANEL_LOG#$ROOT/}"
      [ "$follow" = 1 ] && exec tail -n "$n" -f "$PANEL_LOG"
      tail -n "$n" "$PANEL_LOG" ;;
    amxx)
      local newest
      newest=$(ls -1t "$TREE/cstrike/addons/amxmodx/logs/"*.log 2>/dev/null | head -1)
      [ -n "$newest" ] || die "no AMXX log yet in the tree"
      note "AMXX log: ${newest#$ROOT/}"
      [ "$follow" = 1 ] && exec tail -n "$n" -f "$newest"
      tail -n "$n" "$newest" ;;
  esac
}

cmd_cmd() {
  [ "$#" -gt 0 ] || die "usage: bash scripts/wf-local.sh cmd <console line> ..."
  game_running || die "the game server is not running"
  # Each argument is its own console line, so `cmd wf_give "Ranger" gingerbread 0 10`
  # and `cmd wf_state Ranger wf_force_open` both do what they look like.
  send_cmd "$@"
  note "> $*"
}

cmd_reload() {
  # AMXX 1.10 has no console command that re-reads a plugin binary: `amxx` offers
  # pause/unpause/plugins/modules/cvars/cmds only, and unpausing does not load the
  # file again. A new .amxx therefore needs a server restart - which is fast here
  # (a fresh process starts in ~10 s) and is what this subcommand does, after
  # copying the current build out of the repo.
  say "reload: sync the repo build into the tree, then restart the game server"
  sync_winterfest
  stop_game 1
  boot_game
  local rc=0
  wait_for_boot "$BOOT_TIMEOUT" || rc=$?
  if [ "$rc" -ne 0 ]; then
    warn "the server did not come back (rc=$rc) - last 20 lines of ${LOG#$ROOT/}:"
    tail -20 "$LOG" | sed 's/^/       /' >&2
    return 1
  fi
  ok "back up - Winterfest lines from this boot:"
  grep -E '\[FreeNova winterfest_|\[WF\] config:' "$LOG" | sed 's/^/       /'
  note "config-only changes do not need a restart: bash scripts/wf-local.sh cmd wf_reload
       (owner: core; the gifts half is wf_gifts_reload)"
}

cmd_url() {
  cat <<EOF
connect 127.0.0.1:$PORT        # in the CS 1.6 console
panel   http://$PANEL_HOST:$PANEL_PORT/
winter  http://$PANEL_HOST:$PANEL_PORT/winter
rcon    rcon_password wflocal    (then: rcon <command> from the client)
logs    ${LOG#$ROOT/}  /  ${PANEL_LOG#$ROOT/}
EOF
}

cmd_reset() {
  local all=${1:-}
  stop_game 1
  stop_panel 1
  local vaults=(freenova_wf freenova_wfprog freenova_wfm freenova_wfspin)
  local v
  for v in "${vaults[@]}"; do
    rm -f "$TREE/cstrike/addons/amxmodx/data/vault/$v.vault" \
          "$TREE/cstrike/addons/amxmodx/data/vault/$v.journal"
  done
  ok "dropped the local Winterfest vaults (${vaults[*]})"
  if [ "$all" = "--all" ]; then
    rm -f "$TREE/cstrike/addons/amxmodx/data/vault/"*.vault \
          "$TREE/cstrike/addons/amxmodx/data/vault/"*.journal
    ok "dropped every local vault (--all)"
  fi
  rm -f "$PANEL_DB" "$PANEL_DB-wal" "$PANEL_DB-shm"
  ok "dropped the local panel DB copy; the next start re-copies ${LIVE_DB#$ROOT/}"
  note "the live DB, the live vaults and the tree's maps are untouched"
}

# ---------------------------------------------------------------------------
# 6. smoke - the boot contract
# ---------------------------------------------------------------------------
SMOKE_LOG=""
SMOKE_PASS=0
SMOKE_FAIL=0

smoke_expect() { # smoke_expect <label> <regex>
  local label=$1 pattern=$2 line
  if line=$(grep -E -m1 -- "$pattern" "$SMOKE_LOG" 2>/dev/null); then
    printf '  \033[1;32mok  \033[0m %s\n' "$label"
    printf '        %s\n' "$(printf '%s' "$line" | cut -c1-200)"
    SMOKE_PASS=$((SMOKE_PASS + 1))
    return 0
  fi
  printf '  \033[1;31mFAIL\033[0m %s\n' "$label"
  printf '        no line matching: %s\n' "$pattern"
  SMOKE_FAIL=$((SMOKE_FAIL + 1))
  return 1
}

smoke_absent() { # smoke_absent <label> <regex>
  local label=$1 pattern=$2 hits
  if hits=$(grep -E -m3 -- "$pattern" "$SMOKE_LOG" 2>/dev/null); then
    printf '  \033[1;31mFAIL\033[0m %s\n' "$label"
    printf '%s\n' "$hits" | sed 's/^/        /'
    SMOKE_FAIL=$((SMOKE_FAIL + 1))
    return 1
  fi
  printf '  \033[1;32mok  \033[0m %s\n' "$label"
  SMOKE_PASS=$((SMOKE_PASS + 1))
  return 0
}

cmd_smoke() {
  say "smoke: a fresh boot of $MAP on UDP $PORT"
  stop_game 1
  stop_panel 1
  ensure_tree 0
  sync_winterfest

  # The panel is half of what "run everything locally" means; start it first so
  # its health check is part of the same result. A subshell contains the panel's
  # own failures (a foreign process on the port must not hide the game half).
  local panel_ok=0
  ( start_panel ) && panel_ok=1

  boot_game
  local rc=0
  wait_for_boot "$BOOT_TIMEOUT" || rc=$?
  if [ "$rc" -ne 0 ]; then
    warn "the server did not reach Round_Start (rc=$rc) - last 40 lines:"
    tail -40 "$LOG" | sed 's/^/       /' >&2
    return 1
  fi
  ok "boot reached Round_Start"

  # Ask AMXX for its own plugin table (it is also the only way to see "bad load").
  send_cmd 'amxx plugins'
  sleep 1.5

  SMOKE_LOG="$RUN/smoke.log"
  mkdir -p "$RUN"
  cat "$LOG" > "$SMOKE_LOG"

  echo
  say "assertions (log: ${SMOKE_LOG#$ROOT/})"

  local p
  # every Winterfest plugin in the tree's list must have loaded and initialised
  if [ -f "$PLUGIN_LIST" ]; then
    while read -r p; do
      [ -n "$p" ] || continue
      smoke_expect "plugin loaded: $p" "\[FreeNova ${p}\] ready"
    done < "$PLUGIN_LIST"
  else
    printf '  \033[1;31mFAIL\033[0m no plugin list at %s\n' "${PLUGIN_LIST#$ROOT/}"
    SMOKE_FAIL=$((SMOKE_FAIL + 1))
  fi

  smoke_expect "core parsed the config"   '\[WF\] config: [0-9]+ rarities, [0-9]+ ornaments, [0-9]+ sets, [0-9]+ advent days, [0-9]+ pass tiers'
  smoke_expect "config enabled + vault"   "\[WF\] vault 'freenova_wf' open, config enabled"
  smoke_expect "season window read"       '\[WF\] .*season .*[0-9]{8}-[0-9]{8}'
  smoke_expect "presents resolved"        '\[WF-GIFTS\] [0-9]+ present spot\(s\) on'
  smoke_expect "presents spawned (open)"  '\[WF-GIFTS\] spawned [0-9]+/[0-9]+ present glow\(s\)'
  smoke_expect "spin wheel ready"         '\[WF-SPIN\] ready: [0-9]+ sector'
  smoke_expect "spin sees the season"     '\[WF-SPIN\].*season=open'
  smoke_expect "atmos active"             '\[WF-ATMOS\] active \('
  smoke_expect "progress ready"           '\[WF-PROG\] ready: .*window open'
  smoke_expect "pouch on"                 '\[WF-GIFTS\] pouch (on|off)'
  smoke_expect "modes config read"        '\[WF-(SNOW|REINDEER)\] modes\.ini:'

  smoke_absent "no bad load"              'bad load'
  smoke_absent "no load failures"         'Load fails'
  smoke_absent "no run time error"        'Run time error'
  smoke_absent "no terminated plugin"     'Plugin terminated'
  smoke_absent "no AMXX error"            'AMX Mod X detected an error'
  smoke_absent "no [WF] ERROR"            '\[WF\] ERROR'
  smoke_absent "no paused Winterfest"     'winterfest_[a-z]+\.amxx[[:space:]]+(stopped|paused|bad load)'
  smoke_absent "no closed season"         'season is closed - [0-9]+ spot\(s\) parsed, not spawned'

  # the AMXX plugin table, printed on the console, so the counts are on record
  local table wanted listed
  table=$(grep -E '^[0-9]+ plugins, [0-9]+ running' "$SMOKE_LOG" | tail -1)
  [ -n "$table" ] && note "amxx plugins: $table"
  wanted=$(wc -l < "$PLUGIN_LIST" 2>/dev/null | tr -d ' ')
  listed=$(grep -cE '^[[:space:]]*\[[[:space:]]*[0-9]+\][[:space:]]+[0-9]+[[:space:]]+Winterfest .*running' "$SMOKE_LOG")
  if [ -n "${wanted:-}" ] && [ "${listed:-0}" -ge "${wanted:-0}" ] && [ "${wanted:-0}" -gt 0 ]; then
    printf '  \033[1;32mok  \033[0m %s Winterfest plugin(s) listed as running\n' "$listed"
    SMOKE_PASS=$((SMOKE_PASS + 1))
  else
    printf '  \033[1;31mFAIL\033[0m Winterfest plugins listed as running: %s (expected %s)\n' "${listed:-0}" "${wanted:-?}"
    SMOKE_FAIL=$((SMOKE_FAIL + 1))
  fi

  # presents per map: the rule is 6-10 spots, and every spot must have spawned
  local spots spawned total
  spots=$(grep -oE '\[WF-GIFTS\] [0-9]+ present spot' "$SMOKE_LOG" | grep -oE '[0-9]+' | head -1)
  spawned=$(grep -oE '\[WF-GIFTS\] spawned [0-9]+/[0-9]+' "$SMOKE_LOG" | head -1 | awk -F'[ /]' '{print $3}')
  total=$(grep -oE '\[WF-GIFTS\] spawned [0-9]+/[0-9]+' "$SMOKE_LOG" | head -1 | awk -F'[ /]' '{print $4}')
  if [ -n "$spots" ] && [ -n "$spawned" ] && [ "$spots" = "$spawned" ] && [ "$spawned" = "$total" ]; then
    printf '  \033[1;32mok  \033[0m presents per map: %s spot(s) configured, %s spawned\n' "$spots" "$spawned"
    SMOKE_PASS=$((SMOKE_PASS + 1))
  else
    printf '  \033[1;31mFAIL\033[0m presents per map: configured=%s spawned=%s/%s\n' "${spots:-?}" "${spawned:-?}" "${total:-?}"
    SMOKE_FAIL=$((SMOKE_FAIL + 1))
  fi
  if [ -n "$spots" ] && [ "$spots" -ge 6 ] && [ "$spots" -le 10 ]; then
    printf '  \033[1;32mok  \033[0m spot count inside the owner rule (6-10, default 8)\n'
    SMOKE_PASS=$((SMOKE_PASS + 1))
  else
    printf '  \033[1;31mFAIL\033[0m spot count outside 6-10 (saw %s)\n' "${spots:-none}"
    SMOKE_FAIL=$((SMOKE_FAIL + 1))
  fi

  if [ "$panel_ok" = 1 ]; then
    printf '  \033[1;32mok  \033[0m panel answers on http://%s:%s/\n' "$PANEL_HOST" "$PANEL_PORT"
    SMOKE_PASS=$((SMOKE_PASS + 1))
  else
    printf '  \033[1;31mFAIL\033[0m panel does not answer on http://%s:%s/\n' "$PANEL_HOST" "$PANEL_PORT"
    SMOKE_FAIL=$((SMOKE_FAIL + 1))
  fi

  echo
  if [ "$SMOKE_FAIL" -eq 0 ]; then
    printf '\033[1;32mRESULT ok\033[0m  %d checks passed  (log %s)\n' "$SMOKE_PASS" "${LOG#$ROOT/}"
    cmd_url
    return 0
  fi
  printf '\033[1;31mRESULT fail\033[0m  %d passed, %d failed\n' "$SMOKE_PASS" "$SMOKE_FAIL"
  echo "offending lines (${LOG#$ROOT/}):"
  grep -nE 'bad load|Run time error|Plugin terminated|AMX Mod X detected an error|\[WF\] ERROR|season is closed|pausing self' "$LOG" | head -20 | sed 's/^/  /'
  echo
  echo "the full console of this boot is ${LOG#$ROOT/}; AMXX's own log:"
  echo "  bash scripts/wf-local.sh logs amxx"
  return 1
}

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<EOF

commands:
  start            build the tree (once), boot the game server, start the panel
  stop             stop both (quit -> plugin_end saves, then SIGTERM)
  restart          stop + start
  status           what is running, on which port, where the logs are
  logs [server|panel|amxx] [-f] [-n N]
  cmd <line>       send one console line to the running game server
  reload           sync the repo build into the tree + restart the server (AMXX
                   cannot re-read a .amxx live; config-only changes: cmd wf_reload)
  build [--force]  (re)create build/wf-local/server from the freenova profile
  sync             re-copy the winterfest .amxx + configs into the tree
  panel            start only the panel (start does this too)
  smoke            boot fresh and assert the Winterfest boot contract
  reset [--all]    drop the local vaults + the panel DB copy
  url              the connect string and the panel links
EOF
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "${1:-}" in
  start)   shift; cmd_start "$@" ;;
  stop)    shift; cmd_stop "$@" ;;
  restart) shift; cmd_stop; cmd_start "$@" ;;
  status)  shift; cmd_status "$@" ;;
  logs)    shift; cmd_logs "$@" ;;
  cmd)     shift; cmd_cmd "$@" ;;
  reload)  shift; cmd_reload "$@" ;;
  build)   shift; cmd_build "$@" ;;
  sync)    shift; cmd_sync "$@" ;;
  panel)   shift; ensure_tree 0; sync_winterfest; start_panel ;;
  smoke)   shift; cmd_smoke "$@" ;;
  reset)   shift; cmd_reset "$@" ;;
  url)     shift; cmd_url ;;
  help|-h|--help) usage ;;
  *)       usage; exit 1 ;;
esac
