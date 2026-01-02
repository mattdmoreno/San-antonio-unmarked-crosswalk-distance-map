#!/bin/bash
set -e

echo "Exporting streets_analyzed to PMTiles..."

# Ensure data directory exists
mkdir -p data

# Export and convert
ogr2ogr -f GeoJSONSeq /dev/stdout \
  "PG:host=localhost port=5432 dbname=seattle_pedestrians user=postgres password=postgres" \
  -sql "SELECT osm_id, name, highway, dist_to_crossing_meters, geom FROM streets_analyzed" \
  | tippecanoe -o data/sketchiness.pmtiles \
  --force \
  --layer=streets \
  --minimum-zoom=10 --maximum-zoom=16 \
  --drop-densest-as-needed

echo "Tiles generated at data/sketchiness.pmtiles"
