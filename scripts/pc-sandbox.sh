#!/usr/bin/env bash
# pc-sandbox.sh — a dedicated desktop session for agent-driven game testing.
#
# Why: giving an agent "full PC control" on the live session means it can click
# your browser, your Steam wallet, a terminal. This gives it its own X display
# (:99) and its own D-Bus, so a mis-aimed click lands in a sandbox, and the real
# desktop is untouched. Same idea as a scratch VM, without the VM.
#
#   scripts/pc-sandbox.sh start        # Xvfb :99 + a window manager + a private D-Bus
#   scripts/pc-sandbox.sh status
#   scripts/pc-sandbox.sh env          # prints the environment to point a tool at
#   scripts/pc-sandbox.sh exec <cmd…>  # run a command inside the sandbox
#   scripts/pc-sandbox.sh shot <file>  # screenshot the sandbox to a PNG
#   scripts/pc-sandbox.sh stop
#
# Requires: xorg-server-xvfb openbox xdotool   (install with pacman — see docs)
set -uo pipefail

DISPLAY_NUM="${PC_SANDBOX_DISPLAY:-:99}"
GEOMETRY="${PC_SANDBOX_GEOMETRY:-1600x1000x24}"
RUN="${PC_SANDBOX_RUN:-/tmp/pc-sandbox}"
ENV_FILE="$RUN/env"
XVFB_PID="$RUN/xvfb.pid"
WM_PID="$RUN/wm.pid"
DBUS_PID="$RUN/dbus.pid"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; MISSING=1; }; }
preflight() {
  MISSING=0
  need Xvfb; need openbox; need xdotool; need dbus-daemon
  [ "${MISSING:-0}" -eq 0 ] || {
    cat <<'EOF'
Install what is missing (one line, needs your password):
  sudo pacman -S --needed xorg-server-xvfb openbox xdotool
EOF
    return 1
  }
}

start() {
  mkdir -p "$RUN"
  preflight || return 1
  if status >/dev/null 2>&1; then echo "already running on $DISPLAY_NUM"; return 0; fi

  Xvfb "$DISPLAY_NUM" -screen 0 "$GEOMETRY" -nolisten tcp +extension GLX +extension RANDR +render -noreset \
        >"$RUN/xvfb.log" 2>&1 &
  echo $! > "$XVFB_PID"
  for _ in $(seq 1 50); do [ -S "/tmp/.X11-unix/X${DISPLAY_NUM#:}" ] && break; sleep 0.1; done

  dbus-daemon --session --fork --print-address=1 --print-pid=1 >"$RUN/dbus.out" 2>&1
  local addr pid; addr=$(head -1 "$RUN/dbus.out"); pid=$(tail -1 "$RUN/dbus.out")
  echo "$pid" > "$DBUS_PID"

  cat > "$ENV_FILE" <<EOF
export DISPLAY=$DISPLAY_NUM
export DBUS_SESSION_BUS_ADDRESS=$addr
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export XDG_SESSION_TYPE=x11
export LIBGL_ALWAYS_SOFTWARE=1
EOF

  ( set -a; . "$ENV_FILE"; openbox >"$RUN/wm.log" 2>&1 & echo $! > "$WM_PID" )
  sleep 0.6
  echo "sandbox up on $DISPLAY_NUM ($GEOMETRY)"
}

stop() {
  for f in "$WM_PID" "$DBUS_PID" "$XVFB_PID"; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
    rm -f "$f"
  done
  rm -f "$ENV_FILE"
  echo "sandbox stopped"
}

status() {
  [ -S "/tmp/.X11-unix/X${DISPLAY_NUM#:}" ] || { echo "down"; return 1; }
  echo "up on $DISPLAY_NUM"; [ -f "$ENV_FILE" ] && grep -c export "$ENV_FILE" >/dev/null && echo "env: $ENV_FILE"
}

exec_in() {
  [ -f "$ENV_FILE" ] || { echo "sandbox is not running (start it first)" >&2; return 1; }
  ( set -a; . "$ENV_FILE"; exec "$@" )
}

shot() {
  local out="${1:-$RUN/shot.png}"
  [ -f "$ENV_FILE" ] || { echo "sandbox is not running (start it first)" >&2; return 1; }
  # xwd is in xorg-xwd; fall back to the agent-desktop binary when present
  if command -v import >/dev/null 2>&1; then
    exec_in import -window root "$out"
  elif [ -x /home/ajxs/.local/share/karucode-mcp/node_modules/agent-desktop/bin/agent-desktop ]; then
    exec_in /home/ajxs/.local/share/karucode-mcp/node_modules/agent-desktop/bin/agent-desktop \
      screenshot --screen 0 --output "$out" >/dev/null
  else
    echo "need imagemagick (import) or agent-desktop to take a screenshot" >&2; return 1
  fi
  echo "$out"
}

case "${1:-status}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  env)    [ -f "$ENV_FILE" ] && cat "$ENV_FILE" || { echo "not running" >&2; exit 1; } ;;
  exec)   shift; exec_in "$@" ;;
  shot)   shift; shot "${1:-}" ;;
  *) echo "usage: $0 start|stop|status|env|exec <cmd…>|shot <file>" >&2; exit 2 ;;
esac
