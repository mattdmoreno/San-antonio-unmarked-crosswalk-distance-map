#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"

PBF_URL="https://download.bbbike.org/osm/bbbike/Seattle/Seattle.osm.pbf"
PBF_PATH="$DATA_DIR/Seattle.osm.pbf"

mkdir -p "$DATA_DIR"

if [[ -f "$PBF_PATH" ]]; then
  echo "Already exists: $PBF_PATH"
  exit 0
fi

echo "Downloading Seattle extract…"
# -L follow redirects; --fail to error on non-200
curl -L --fail --retry 3 --retry-delay 2 -o "$PBF_PATH" "$PBF_URL"

echo "Downloaded: $PBF_PATH"
