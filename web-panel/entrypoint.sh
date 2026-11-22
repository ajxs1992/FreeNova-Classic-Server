#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ -f package.json ] && grep -q '"start"' package.json; then
  exec npm start
elif [ -f server.js ]; then
  exec node server.js
elif [ -f index.js ]; then
  exec node index.js
else
  echo "FATAL: no start script, server.js or index.js found." >&2
  exit 1
fi
