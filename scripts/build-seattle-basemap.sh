#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"

PBF_PATH="$DATA_DIR/Seattle.osm.pbf"
OUT_PATH="$DATA_DIR/basemap-seattle.pmtiles"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required (install Docker Desktop)." >&2
  exit 1
fi

if [[ ! -f "$PBF_PATH" ]]; then
  echo "Missing OSM extract: $PBF_PATH" >&2
  echo "Run: ./scripts/get-seattle-osm-pbf.sh" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

echo "Building basemap PMTiles (this may download extra sources into ./data)…"

docker run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx4g" \
  -v "$DATA_DIR":/data \
  ghcr.io/onthegomap/planetiler:latest \
  --download \
  --osm-path=/data/Seattle.osm.pbf \
  --output=/data/basemap-seattle.pmtiles \
  --force

echo "Wrote: $OUT_PATH"
