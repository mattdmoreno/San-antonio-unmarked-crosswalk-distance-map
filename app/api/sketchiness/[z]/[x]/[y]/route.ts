import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/seattle_pedestrians',
});

function parseZxy(params: { z: string; x: string; y: string }) {
  const z = Number.parseInt(params.z, 10);
  const x = Number.parseInt(params.x, 10);
  const y = Number.parseInt(params.y, 10);

  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (z < 0 || z > 22) return null;
  if (x < 0 || y < 0) return null;

  return { z, x, y };
}

// Serves Mapbox Vector Tiles (MVT) from PostGIS, layer name: "streets".
// Requires the analysis step to have created `streets_analyzed`.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const params = await context.params;
  const zxy = parseZxy(params);
  if (!zxy) {
    return NextResponse.json({ error: 'Invalid z/x/y' }, { status: 400 });
  }

  const { z, x, y } = zxy;

  // NOTE: `ST_TileEnvelope` is in WebMercator (EPSG:3857).
  // osm2pgsql typically imports geometries in 3857, so we assume `streets_analyzed.geom` is also 3857.
  const sql = `
    WITH
      bounds AS (
        SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS geom
      ),
      mvtgeom AS (
        SELECT
          osm_id,
          name,
          highway,
          dist_to_crossing_meters,
          nearest_crossing_marked,
          ST_AsMVTGeom(s.geom, b.geom, 4096, 256, true) AS geom
        FROM streets_analyzed s
        JOIN bounds b ON TRUE
        WHERE ST_Intersects(s.geom, b.geom)
      )
    SELECT COALESCE(ST_AsMVT(mvtgeom, 'streets', 4096, 'geom'), ''::bytea) AS tile
    FROM mvtgeom;
  `;

  try {
    const result = await pool.query<{ tile: Buffer }>(sql, [z, x, y]);
    const tile = result.rows[0]?.tile ?? Buffer.from('');

    // NextResponse wants a web BodyInit; Uint8Array works across runtimes.
    const body = new Uint8Array(tile);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        // Cache a bit in dev; in prod you may want longer + a CDN.
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    // Most common causes: DB not running, analysis table missing.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate tile', message },
      { status: 500 },
    );
  }
}
