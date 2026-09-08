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

# Make repeated launches safe when Diff is already running from another
# terminal or the desktop environment. Verify the app response rather than
# treating any process that happens to own the port as Diff.
if curl -fsS --max-time 1 http://127.0.0.1:5273/ >/dev/null 2>&1; then
  echo "Diff is already running at http://127.0.0.1:5273"
  exit 0
fi

echo "Serving http://127.0.0.1:5273"
exec npm start
