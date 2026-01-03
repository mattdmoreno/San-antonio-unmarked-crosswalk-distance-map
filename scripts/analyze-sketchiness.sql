\set ON_ERROR_STOP on
\set VERBOSITY verbose
\timing on

-- Analysis area (bounding box)
--
-- Geometries from osm2pgsql are typically in EPSG:3857, but the bbox is easiest to specify in lon/lat (EPSG:4326).
-- Override these via psql vars if desired, e.g.:
--   psql ... -v min_lon=-122.34 -v min_lat=47.59 -v max_lon=-122.32 -v max_lat=47.61 -v bbox_buffer_m=200
-- Defaults cover the full world so existing behavior is unchanged unless you override.
-- Downtown Seattle (roughly): Belltown/SODO edge to First Hill edge.
\set min_lon -122.356
\set min_lat 47.592
\set max_lon -122.320
\set max_lat 47.619
\set bbox_buffer_m 200

DROP TABLE IF EXISTS analysis_bounds;
CREATE UNLOGGED TABLE analysis_bounds AS
SELECT
    ST_Buffer(
        ST_Transform(
            ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326),
            3857
        ),
        :bbox_buffer_m
    ) AS geom;

ANALYZE analysis_bounds;

\echo 'Phase 1/3: Build crosswalks'
-- Create a table of crosswalks (marked + unmarked).
--
-- Notes:
-- - OSM encodes crossings in a few ways: highway=crossing (often POINTs) and/or highway=footway + footway=crossing (often LINESTRINGs).
-- - `crossing=*` values vary widely (unmarked, marked, zebra, traffic_signals, uncontrolled, ...).
-- - We set `marked=true` only when the tag includes "marked" or "zebra"; otherwise it's treated as unmarked.
-- - For performance/simplicity, we do NOT snap crossings to specific road OSM ways.
--   Phase 3 uses the nearest eligible crossing globally (within the bbox).
DROP TABLE IF EXISTS crosswalks_raw;
CREATE UNLOGGED TABLE crosswalks_raw AS
SELECT
        osm_id,
        'node'::text AS osm_type,
        way AS geom,
        COALESCE(NULLIF(tags->'crossing', ''), 'unknown') AS crossing_type,
        ((tags->'crossing') ILIKE '%marked%' OR (tags->'crossing') ILIKE '%zebra%') AS marked
FROM planet_osm_point
JOIN analysis_bounds b ON TRUE
WHERE highway = 'crossing'
    AND way && b.geom
UNION ALL
SELECT
        osm_id,
        'way'::text AS osm_type,
        way AS geom,
        COALESCE(NULLIF(tags->'crossing', ''), 'unknown') AS crossing_type,
        ((tags->'crossing') ILIKE '%marked%' OR (tags->'crossing') ILIKE '%zebra%') AS marked
FROM planet_osm_line
JOIN analysis_bounds b ON TRUE
WHERE highway = 'footway'
    AND tags->'footway' = 'crossing'
        AND way && b.geom
;

-- Note: no index needed on crosswalks_raw for the steps below.

DROP TABLE IF EXISTS crosswalks;
CREATE UNLOGGED TABLE crosswalks AS
SELECT
    osm_id AS crossing_osm_id,
    osm_type AS crossing_osm_type,
    geom,
    crossing_type,
    marked
FROM crosswalks_raw;

-- Index for nearest-crosswalk lookup.
CREATE INDEX idx_crosswalks_geom ON crosswalks USING GIST (geom);

ANALYZE crosswalks;

-- Create a table of streets to analyze, segmented into ~20m chunks
\echo 'Phase 2/3: Build segmented streets'
DROP TABLE IF EXISTS streets_analyzed;
CREATE UNLOGGED TABLE streets_analyzed AS
WITH simple_lines AS (
    -- Ensure we have single LineStrings
        SELECT
                osm_id,
                name,
                highway,
                ST_Intersection((ST_Dump(way)).geom, b.geom) AS geom
    FROM planet_osm_line
    JOIN analysis_bounds b ON TRUE
    WHERE highway IN ('residential', 'tertiary', 'secondary', 'primary', 'trunk')
            AND way && b.geom
),
simple_lines_with_len AS (
    SELECT osm_id, name, highway, geom, ST_Length(geom) AS geom_len
    FROM simple_lines
        WHERE NOT ST_IsEmpty(geom)
            AND ST_Length(geom) > 0
),
segmented AS (
    SELECT
        osm_id,
        name,
        highway,
        ST_LineSubstring(
            geom,
            n * 20.0 / geom_len,
            LEAST((n + 1) * 20.0 / geom_len, 1.0)
        ) AS geom
    FROM
        simple_lines_with_len
    CROSS JOIN LATERAL
        generate_series(0, CEIL(geom_len / 20.0)::int - 1) AS n
)
SELECT * FROM segmented;

-- Creating a GiST index on this large segmented table is expensive and is not needed for the
-- nearest-crosswalk update (it drives off crosswalks' GiST index). Add later only if you need it.
-- CREATE INDEX idx_streets_analyzed_geom ON streets_analyzed USING GIST (geom);

-- Add a column for sketchiness (distance to nearest crosswalk)
ALTER TABLE streets_analyzed ADD COLUMN dist_to_crossing_meters FLOAT;
ALTER TABLE streets_analyzed ADD COLUMN nearest_crossing_marked BOOLEAN;

-- Calculate distance to nearest *eligible* crosswalk (globally, within bbox).
-- Performance note: planet_osm_* geometries are in Web Mercator (EPSG:3857) by default,
-- where units are meters-ish. Using geometry distance avoids expensive geography transforms.
\echo 'Phase 3/3: Compute nearest crosswalk distance'
WITH nearest AS (
    SELECT
        s.ctid AS street_ctid,
        cw.dist_to_crossing_meters,
        cw.nearest_crossing_marked
    FROM streets_analyzed s
    JOIN LATERAL (
        SELECT
            ST_Distance(s.geom, c.geom) AS dist_to_crossing_meters,
            c.marked AS nearest_crossing_marked
        FROM crosswalks c
        WHERE c.crossing_type NOT ILIKE '%unmarked%'
        ORDER BY s.geom <-> c.geom
        LIMIT 1
    ) cw ON TRUE
)
UPDATE streets_analyzed s
SET
    dist_to_crossing_meters = n.dist_to_crossing_meters,
    nearest_crossing_marked = n.nearest_crossing_marked
FROM nearest n
WHERE s.ctid = n.street_ctid;

ANALYZE streets_analyzed;
