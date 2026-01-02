#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npx >/dev/null 2>&1; then
  echo "Error: npx is required (install Node.js)." >&2
  exit 1
fi

echo "Serving ./data on http://localhost:8080 (requires Range requests for PMTiles)…"
exec npx http-server "$ROOT_DIR/data" --cors -p 8080 -c-1
