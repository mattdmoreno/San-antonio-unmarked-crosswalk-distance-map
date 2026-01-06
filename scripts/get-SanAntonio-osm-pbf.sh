#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"

PBF_URL="https://download.bbbike.org/osm/extract/planet_-98.928,29.245_-98.025,29.718.osm.pbf"
PBF_PATH="$DATA_DIR/planet_-98.928,29.245_-98.025,29.718.osm.pbf"

mkdir -p "$DATA_DIR"

if [[ -f "$PBF_PATH" ]]; then
  echo "Already exists: $PBF_PATH"
  exit 0
fi

echo "Downloading San Antonio extract…"
# -L follow redirects; --fail to error on non-200
curl -L --fail --retry 3 --retry-delay 2 -o "$PBF_PATH" "$PBF_URL"

echo "Downloaded: $PBF_PATH"
