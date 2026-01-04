#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"

TIPPECANOE_READ_PARALLEL="${TIPPECANOE_READ_PARALLEL:-1}"

# PostGIS connection (defaults match docker-compose.yml)
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-seattle_pedestrians}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"

echo "Exporting streets_analyzed + unmarked_crosswalk_points_enriched -> MBTiles -> PMTiles..."

# Ensure data directory exists
mkdir -p "$DATA_DIR"

OUT_MBTILES="$DATA_DIR/sketchiness.mbtiles"
OUT_PMTILES="$DATA_DIR/sketchiness.pmtiles"

rm -f "$OUT_MBTILES" "$OUT_PMTILES"

# Export GeoJSONSeq to a temp file (tippecanoe reads from files)
# Use a system temp dir to avoid repo permission/ownership issues (e.g., if `data/tmp` was created by Docker as root).
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

STREETS_GJ="$TMP_DIR/streets.geojsonseq"
UNMARKED_GJ="$TMP_DIR/unmarked_crossings.geojsonseq"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required (DB is in docker-compose)." >&2
  exit 1
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "db"; then
  echo "Error: docker compose service 'db' is not running." >&2
  echo "Run: docker compose up -d" >&2
  exit 1
fi

echo "Checking that streets_analyzed exists..."
docker compose exec -T db psql \
  -U "$PGUSER" \
  -d "$PGDATABASE" \
  -X \
  -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('public.streets_analyzed') AS table_name;" \
  | grep -q streets_analyzed \
  || { echo "Error: streets_analyzed not found. Run ./scripts/run-analysis.sh first." >&2; exit 1; }

echo "Checking that unmarked_crosswalk_points_enriched exists..."
docker compose exec -T db psql \
  -U "$PGUSER" \
  -d "$PGDATABASE" \
  -X \
  -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('public.unmarked_crosswalk_points_enriched') AS table_name;" \
  | grep -q unmarked_crosswalk_points_enriched \
  || { echo "Error: unmarked_crosswalk_points_enriched not found. Run ./scripts/run-analysis.sh first." >&2; exit 1; }

echo "Counting rows in streets_analyzed..."
ROWCOUNT="$(docker compose exec -T db psql -U "$PGUSER" -d "$PGDATABASE" -X -At -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM streets_analyzed;")"
echo "streets_analyzed rows: $ROWCOUNT"
if [[ "$ROWCOUNT" = "0" ]]; then
  echo "Warning: streets_analyzed is empty; tiles will be empty." >&2
fi

echo "Exporting GeoJSONSeq via ogr2ogr..."
ogr2ogr -f GeoJSONSeq "$STREETS_GJ" \
  "PG:host=$PGHOST port=$PGPORT dbname=$PGDATABASE user=$PGUSER password=$PGPASSWORD" \
  -sql "SELECT osm_id, name, highway, COALESCE(LEAST(dist_to_crossing_meters, 500.0), 500.0) AS dist_to_crossing_meters, nearest_crossing_marked, maxspeed, lanes, frogger_index, geom FROM streets_analyzed WHERE geom IS NOT NULL"

ogr2ogr -f GeoJSONSeq "$UNMARKED_GJ" \
  "PG:host=$PGHOST port=$PGPORT dbname=$PGDATABASE user=$PGUSER password=$PGPASSWORD" \
  -sql "SELECT point_osm_id, frogger_index, frogger_dist_to_marked_crosswalk_m, frogger_road_highway, frogger_lanes, frogger_maxspeed, frogger_speed_mph, geom FROM unmarked_crosswalk_points_enriched WHERE geom IS NOT NULL"

GJ_LINES="$(wc -l < "$STREETS_GJ" | tr -d ' ')"
GJ_SIZE="$(du -h "$STREETS_GJ" | awk '{print $1}')"
echo "GeoJSONSeq written: $GJ_LINES lines ($GJ_SIZE)"

UNMARKED_LINES="$(wc -l < "$UNMARKED_GJ" | tr -d ' ')"
UNMARKED_SIZE="$(du -h "$UNMARKED_GJ" | awk '{print $1}')"
echo "Unmarked crossings GeoJSONSeq written: $UNMARKED_LINES lines ($UNMARKED_SIZE)"

if [[ "$GJ_LINES" = "0" ]]; then
  echo "Error: exported GeoJSONSeq is empty; aborting tile generation." >&2
  exit 1
fi

echo "Generating MBTiles with tippecanoe..."
tippecanoe -o "$OUT_MBTILES" \
  --force \
  --minimum-zoom=10 --maximum-zoom=16 \
  $( [ "$TIPPECANOE_READ_PARALLEL" = "1" ] && printf %s "--read-parallel" ) \
  --drop-densest-as-needed \
  -L "streets:$STREETS_GJ" \
  -L "unmarked_crossings:$UNMARKED_GJ"
echo "Tiles generated at $OUT_MBTILES"

# Convert MBTiles (SQLite) -> PMTiles.
echo "Converting MBTiles -> PMTiles..."

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$DATA_DIR":/data \
  ghcr.io/protomaps/go-pmtiles:latest \
  convert /data/sketchiness.mbtiles /data/sketchiness.pmtiles

echo "Tiles generated at $OUT_PMTILES"
