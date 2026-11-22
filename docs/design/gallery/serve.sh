#!/bin/sh
# Start the design gallery on a free port and print the URL.
#
#   ./serve.sh            # pick the first free port from 8000
#   PORT=9000 ./serve.sh  # force a port
#
# Ctrl-C stops it. No dependencies: python3's http.server only.

set -eu
cd "$(dirname "$0")"

if [ ! -f manifest.js ]; then
  echo "manifest.js is missing - build it first:" >&2
  echo "  python3 tools/design/build_gallery.py" >&2
  exit 1
fi

find_free_port() {
  start=${1:-8000}
  port=$start
  while [ "$port" -lt $((start + 200)) ]; do
    if ! python3 - "$port" <<'PY'
import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
    then
      port=$((port + 1))
      continue
    fi
    echo "$port"
    return 0
  done
  return 1
}

if [ -n "${PORT:-}" ]; then
  port=$PORT
else
  port=$(find_free_port "${START_PORT:-8000}") || {
    echo "no free port found in 8000-8199; try PORT=<n> ./serve.sh" >&2
    exit 1
  }
fi

url="http://127.0.0.1:${port}/index.html"
echo "design gallery: $url"
echo "viewer:         http://127.0.0.1:${port}/viewer.html?ref=01-dashboard"
echo "compare mode:   add &base=http://127.0.0.1:18101 to point at a local panel build"
echo "serving $(pwd) - Ctrl-C to stop"
exec python3 -m http.server "$port" --bind 127.0.0.1
