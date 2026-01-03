#!/bin/bash
set -e

echo "Running sketchiness analysis..."

PSQL_VARS=()
if [ -n "${MIN_LON:-}" ]; then PSQL_VARS+=( -v "min_lon=$MIN_LON" ); fi
if [ -n "${MIN_LAT:-}" ]; then PSQL_VARS+=( -v "min_lat=$MIN_LAT" ); fi
if [ -n "${MAX_LON:-}" ]; then PSQL_VARS+=( -v "max_lon=$MAX_LON" ); fi
if [ -n "${MAX_LAT:-}" ]; then PSQL_VARS+=( -v "max_lat=$MAX_LAT" ); fi
if [ -n "${BBOX_BUFFER_M:-}" ]; then PSQL_VARS+=( -v "bbox_buffer_m=$BBOX_BUFFER_M" ); fi

docker compose exec -T db psql \
	-U postgres \
	-d seattle_pedestrians \
	-X \
	"${PSQL_VARS[@]}" \
	-v ON_ERROR_STOP=1 \
	--echo-errors \
	< scripts/analyze-sketchiness.sql
echo "Analysis complete!"
