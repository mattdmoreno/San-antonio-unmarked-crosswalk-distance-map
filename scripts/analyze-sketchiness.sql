-- Create a table of crosswalks
DROP TABLE IF EXISTS crosswalks;
CREATE TABLE crosswalks AS
SELECT way AS geom FROM planet_osm_point WHERE highway = 'crossing'
UNION ALL
SELECT way AS geom FROM planet_osm_line WHERE highway = 'footway' AND tags->'footway' = 'crossing';

CREATE INDEX idx_crosswalks_geom ON crosswalks USING GIST (geom);

-- Create a table of streets to analyze
DROP TABLE IF EXISTS streets_analyzed;
CREATE TABLE streets_analyzed AS
SELECT osm_id, name, highway, way AS geom
FROM planet_osm_line
WHERE highway IN ('residential', 'tertiary', 'secondary', 'primary', 'trunk', 'service', 'unclassified', 'footway', 'path', 'cycleway');

CREATE INDEX idx_streets_analyzed_geom ON streets_analyzed USING GIST (geom);

-- Add a column for sketchiness (distance to nearest crosswalk)
ALTER TABLE streets_analyzed ADD COLUMN dist_to_crossing_meters FLOAT;

-- Calculate distance using KNN
-- Using geography type for accurate meters
UPDATE streets_analyzed s
SET dist_to_crossing_meters = (
  SELECT ST_Distance(ST_Transform(s.geom, 4326)::geography, ST_Transform(c.geom, 4326)::geography)
  FROM crosswalks c
  ORDER BY s.geom <-> c.geom
  LIMIT 1
);
