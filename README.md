# Pedestrian sketchiness map

This repo will generate a **normal-looking basemap** for Seattle from OpenStreetMap data and package it as **PMTiles** (vector tiles).

The current setup builds an **OpenMapTiles-compatible** tileset using **Planetiler** (via Docker).

## Prerequisites

- Docker Desktop (for running Planetiler)
- `curl`
- Node.js (for the Next.js app)
- `pnpm` (recommended; or enable via `corepack`)

## Build the Seattle basemap (PMTiles)

1) Download the Seattle OSM extract (PBF):

```sh
./scripts/get-seattle-osm-pbf.sh
```

2) Build the basemap PMTiles:

```sh
./scripts/build-seattle-basemap.sh
```

Outputs:
- `data/Seattle.osm.pbf`
- `data/basemap-seattle.pmtiles`

## Serve locally (for testing)

PMTiles requires an HTTP server that supports **Range requests**.

From the repo root:

This repo’s dev script starts a tiles server automatically (see below), but you can also run it directly:

```sh
pnpm dev:tiles
```

Then your PMTiles is available at:
- `http://localhost:8080/basemap-seattle.pmtiles`

## Run the web app (Next.js)

Install deps:

```sh
pnpm install
```

Start dev (runs Next.js + tile server together):

```sh
pnpm dev
```

## Notes

- Planetiler’s OpenMapTiles profile downloads additional global sources (Natural Earth, water polygons, etc.). These are cached under `data/`.
- OSM attribution is required in the frontend UI: “© OpenStreetMap contributors”.
