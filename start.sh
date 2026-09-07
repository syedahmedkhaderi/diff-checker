#!/usr/bin/env bash
# Start the app.
#   ./start.sh        production build served from one origin  http://127.0.0.1:5273
#   ./start.sh dev    Vite dev server + companion             http://127.0.0.1:5173
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/Library/TeX/texbin:$PATH"

if [ ! -d node_modules ]; then
  echo "Dependencies not installed. Run ./setup.sh first." >&2
  exit 1
fi

if [ "${1:-}" = "dev" ]; then
  exec npm run dev
fi

if [ ! -d dist ]; then
  echo "Building..."
  npm run build
fi
echo "Serving http://127.0.0.1:5273"
exec npm start
