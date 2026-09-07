#!/usr/bin/env bash
# One-time setup: install dependencies and build the app.
set -euo pipefail
cd "$(dirname "$0")"

need_node="22.13.0"
have_node="$(node -p 'process.versions.node' 2>/dev/null || echo 0.0.0)"
lowest="$(printf '%s\n%s\n' "$need_node" "$have_node" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)"
if [ "$lowest" != "$need_node" ]; then
  echo "Node.js $need_node or later is required (found $have_node)." >&2
  exit 1
fi

echo "Installing dependencies..."
npm install

echo
echo "Checking LaTeX tools (optional, only needed for compiled PDF comparison)..."
export PATH="/Library/TeX/texbin:$PATH"
missing=0
for tool in latexmk latexdiff latexpand pdflatex; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "  found    $tool"
  else
    echo "  missing  $tool"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "  -> Text comparison works without these. Install a TeX distribution (e.g. MacTeX/TeX Live) to enable PDF compilation."
fi

echo
echo "Building..."
npm run build

echo
echo "Setup complete. Run ./start.sh"
