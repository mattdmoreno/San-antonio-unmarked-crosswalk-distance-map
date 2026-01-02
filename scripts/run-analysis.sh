#!/bin/bash
set -e

echo "Running sketchiness analysis..."
docker compose exec -T db psql -U postgres -d seattle_pedestrians < scripts/analyze-sketchiness.sql
echo "Analysis complete!"
