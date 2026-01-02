'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import * as pmtiles from 'pmtiles';

const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

function buildBasicOpenMapTilesStyle(pmtilesUrl: string, sketchinessUrl: string): StyleSpecification {
  return {
    version: 8,
    name: 'Seattle (PMTiles) – basic',
    // MapLibre validates `glyphs` as required. Using the public OpenMapTiles font server for now.
    // If/when you want fully offline hosting, serve your own glyph PBFs.
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      omtiles: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
      },
      sketchiness: {
        type: 'vector',
        url: `pmtiles://${sketchinessUrl}`,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f8f8f8' } },

      // Water
      {
        id: 'water',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#bcd3e6' },
      },

      // Parks (very rough)
      {
        id: 'park',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'park',
        paint: { 'fill-color': '#d6ead2' },
      },

      // Landuse (optional; helps the map feel "normal")
      {
        id: 'landuse',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'landuse',
        paint: { 'fill-color': '#efefef' },
      },

      // Buildings
      {
        id: 'building',
        type: 'fill',
        source: 'omtiles',
        'source-layer': 'building',
        paint: {
          'fill-color': '#e0e0e0',
          'fill-outline-color': '#d0d0d0',
        },
      },

      // Roads (OpenMapTiles: transportation)
      {
        id: 'roads',
        type: 'line',
        source: 'omtiles',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            1.5,
            14,
            5,
          ],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'roads-outline',
        type: 'line',
        source: 'omtiles',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#cfcfcf',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            0.8,
            10,
            2.2,
            14,
            6,
          ],
          'line-opacity': 0.7,
        },
      },
      // Sketchiness Layer
      {
        id: 'sketchiness-lines',
        type: 'line',
        source: 'sketchiness',
        'source-layer': 'streets',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            2,
            15,
            5,
            20,
            12,
          ],
          'line-color': [
            'interpolate',
            ['linear'],
            ['get', 'dist_to_crossing_meters'],
            0,
            '#4caf50', // Chill Green
            50,
            '#fdd835', // Mellow Yellow
            100,
            '#e53935', // Red
            200,
            '#b71c1c', // Dark Red
          ],
          'line-opacity': 0.8,
        },
      },
      // Labels (Place names)
      {
        id: 'place_label',
        type: 'symbol',
        source: 'omtiles',
        'source-layer': 'place',
        minzoom: 10,
        layout: {
          'text-field': '{name}',
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#333333',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      },
    ],
  } as StyleSpecification;
}

export default function Map() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const pmtilesUrl = useMemo(() => {
    // Served by `npm run dev` (http-server ./data)
    return 'http://localhost:8080/basemap-seattle.pmtiles';
  }, []);

  const sketchinessUrl = useMemo(() => {
    return 'http://localhost:8080/sketchiness.pmtiles';
  }, []);

  const style = useMemo(() => buildBasicOpenMapTilesStyle(pmtilesUrl, sketchinessUrl), [pmtilesUrl, sketchinessUrl]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    console.log('Initializing map with style:', style);

    if (mapRef.current) {
      mapRef.current.setStyle(style);
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: SEATTLE_CENTER,
      zoom: 11,
      minZoom: 2,
      maxZoom: 20,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    mapRef.current = map;

    // Add click handler for sketchiness lines
    map.on('click', 'sketchiness-lines', (e) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;
      
      if (!props) return;

      const coordinates = e.lngLat;
      
      // Helper to capitalize words
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      
      let displayName = props.name;
      const highwayType = props.highway ? capitalize(props.highway) : 'Unknown Type';

      // If no name, construct a descriptive name from the type
      if (!displayName) {
        displayName = `${highwayType} Road`;
      }

      const distance = typeof props.dist_to_crossing_meters === 'number' 
        ? Math.round(props.dist_to_crossing_meters) 
        : 'N/A';

      new maplibregl.Popup()
        .setLngLat(coordinates)
        .setHTML(`
          <div style="font-family: sans-serif; padding: 4px;">
            <h3 style="margin: 0 0 4px; font-size: 14px; font-weight: bold;">${displayName}</h3>
            <p style="margin: 0; font-size: 12px;">Type: ${highwayType}</p>
            <p style="margin: 0; font-size: 12px;">Dist to Crosswalk: <strong>${distance}m</strong></p>
          </div>
        `)
        .addTo(map);
    });

    // Change cursor on hover
    map.on('mouseenter', 'sketchiness-lines', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'sketchiness-lines', () => {
      map.getCanvas().style.cursor = '';
    });

    return () => {
      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, [style]);

  return <div id="map" ref={mapContainerRef} />;
}
