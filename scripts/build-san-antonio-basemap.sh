#!/bin/bash
set -e

# Name your output tiles
export AREA_NAME="san-antonio"

# Generate PMTiles via Planetiler
docker run --rm \
  -v "$(pwd)/data:/data" \
  ghcr.io/onthegomap/planetiler:latest \
  --osm-path=/data/san-antonio.osm.pbf \
  --output=/data/basemap-${AREA_NAME}.pmtiles \
  --profile=openmaptiles

