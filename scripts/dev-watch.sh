#!/usr/bin/env bash
# dev-watch.sh — keep the local panel up while agents work, and keep the tree honest.
# A panel that silently dies makes every agent report a 404 as a finished page.
#   scripts/dev-watch.sh start | stop | status | once
RUN=${TMPDIR:-/tmp}/dev-watch; mkdir -p "$RUN"
PANEL_LOG="$RUN/panel.log"
start_watch() {
  if [ -f "$RUN/watcher.pid" ] && kill -0 "$(cat "$RUN/watcher.pid")" 2>/dev/null; then
    echo "watcher already running (pid $(cat "$RUN/watcher.pid"))"; return 0; fi
  setsid nohup bash -c '
    RUN="'"$RUN"'"; ROOT="'"$PWD"'"
    while :; do
      if ! ss -ltn 2>/dev/null | grep -q ":18101 "; then
        ( cd "$ROOT/web-panel" && PORT=18101 setsid nohup node server_local.mjs >>"'"$PANEL_LOG"'" 2>&1 < /dev/null & )
        echo "$(date +%FT%T) panel restarted" >> "'"$RUN"'/watch.log"
        sleep 6
      fi
      sleep 20
    done' > /dev/null 2>&1 < /dev/null &
  echo $! > "$RUN/watcher.pid"
  echo "watcher started (pid $!) — panel on :18101 is now kept alive"
}
case "${1:-status}" in
  start) start_watch ;;
  stop)  [ -f "$RUN/watcher.pid" ] && kill "$(cat "$RUN/watcher.pid")" 2>/dev/null; rm -f "$RUN/watcher.pid"; echo stopped ;;
  status) ss -ltn 2>/dev/null | grep -q ":18101 " && echo "panel: up" || echo "panel: DOWN"
          [ -f "$RUN/watcher.pid" ] && echo "watcher: $(cat "$RUN/watcher.pid")" || echo "watcher: none" ;;
  once)  curl -sS -o /dev/null -w 'panel / -> %{http_code}\n' --max-time 6 http://192.168.1.5:18101/ ;;
esac
