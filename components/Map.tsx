'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pmtiles from 'pmtiles';

import FeatureInfoPanel, { type FeatureInfo } from './FeatureInfoPanel';

const SEATTLE_CENTER: [number, number] = [-122.3321, 47.6062];

const SKETCHINESS_LAYER_IDS = ['sketchiness-lines-out', 'sketchiness-lines-in'] as const;

type ViewportParams = {
  lat: number;
  lng: number;
  zoom: number;
};

type PinnedParams = {
  lngLat: maplibregl.LngLat;
  zoom?: number;
};

function parseInitialViewportFromUrl(): ViewportParams | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const latRaw = params.get('lat');
  const lngRaw = params.get('lng');
  const zoomRaw = params.get('z') ?? params.get('zoom');

  if (!latRaw || !lngRaw || !zoomRaw) return null;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const zoom = Number(zoomRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng, zoom };
}

function parsePinnedParamsFromUrl(): PinnedParams | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const pinRaw = params.get('pin');
  const hasPin = pinRaw === '1' || pinRaw === 'true' || pinRaw === 't' || pinRaw === 'yes' || pinRaw === 'y';
  if (!hasPin) return null;

  const latRaw = params.get('lat');
  const lngRaw = params.get('lng');
  if (!latRaw || !lngRaw) return null;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const zoomRaw = params.get('z') ?? params.get('zoom');
  const zoom = zoomRaw ? Number(zoomRaw) : undefined;

  return {
    lngLat: new maplibregl.LngLat(lng, lat),
    zoom: typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : undefined,
  };
}

function setUrlViewport({ lat, lng, zoom }: ViewportParams) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  url.searchParams.set('lat', lat.toFixed(6));
  url.searchParams.set('lng', lng.toFixed(6));
  url.searchParams.set('z', zoom.toFixed(2));
  url.searchParams.delete('zoom');

  window.history.replaceState(null, '', url.toString());
}

function clearUrlPin() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has('pin')) return;

  url.searchParams.delete('pin');
  window.history.replaceState(null, '', url.toString());
}

function buildReportIssueUrl(template: string, lngLat: maplibregl.LngLat, zoom?: number): string {
  const lat = lngLat.lat.toFixed(6);
  const lng = lngLat.lng.toFixed(6);
  const zoomStr = typeof zoom === 'number' ? zoom.toFixed(2) : '';

  return template
    .replaceAll('{lat}', encodeURIComponent(lat))
    .replaceAll('{lng}', encodeURIComponent(lng))
    .replaceAll('{latLng}', encodeURIComponent(`${lat},${lng}`))
    .replaceAll('{zoom}', encodeURIComponent(zoomStr));
}

function buildBasicOpenMapTilesStyle(pmtilesUrl: string, sketchinessUrl: string): StyleSpecification {
  const SKETCHINESS_CAP_SWITCH_ZOOM = 15;

  const sketchinessLinePaint = {
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5, 20, 12],
    // Residential streets are always green; other roads scale by distance.
    'line-color': [
      'case',
      ['==', ['get', 'highway'], 'residential'],
      '#4caf50',
      ['interpolate', ['linear'], ['get', 'dist_to_crossing_meters'], 0, '#4caf50', 100, '#fdd835', 200, '#e53935', 500, '#b71c1c'],
    ],
    // Differentiate marked vs unmarked crossings.
    // If nearest crossing is unmarked, render as dashed.
    'line-opacity': 0.8,
  };

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
        id: 'sketchiness-lines-out',
        type: 'line',
        source: 'sketchiness',
        'source-layer': 'streets',
        maxzoom: SKETCHINESS_CAP_SWITCH_ZOOM,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: sketchinessLinePaint,
      },
      {
        id: 'sketchiness-lines-in',
        type: 'line',
        source: 'sketchiness',
        'source-layer': 'streets',
        minzoom: SKETCHINESS_CAP_SWITCH_ZOOM,
        layout: {
          'line-join': 'round',
          'line-cap': 'butt',
        },
        paint: sketchinessLinePaint,
      },

      // Road labels (street names)
      {
        id: 'road_label',
        type: 'symbol',
        source: 'omtiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': [
            'coalesce',
            ['get', 'name:en'],
            ['get', 'name'],
            ['get', 'ref'],
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            10,
            16,
            13,
          ],
          'text-max-angle': 30,
          'text-padding': 2,
          'text-keep-upright': true,
        },
        paint: {
          'text-color': '#333333',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
          'text-halo-blur': 0.5,
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
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const previouslyHadSelectionRef = useRef(false);

  const [selected, setSelected] = useState<FeatureInfo | null>(null);

  // If this page was opened via a share link (pin=1), we keep `pin` in the URL
  // while the feature panel is open. Once the panel closes, remove it.
  useEffect(() => {
    const hasSelection = Boolean(selected);
    if (previouslyHadSelectionRef.current && !hasSelection) {
      clearUrlPin();
    }
    previouslyHadSelectionRef.current = hasSelection;
  }, [selected]);

  const handleShare = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    if (!selected) return false;

    const map = mapRef.current;
    const zoom = map ? map.getZoom() : 11;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', selected.lngLat.lat.toFixed(6));
    url.searchParams.set('lng', selected.lngLat.lng.toFixed(6));
    url.searchParams.set('z', zoom.toFixed(2));
    url.searchParams.set('pin', '1');
    url.searchParams.delete('zoom');

    const shareText = url.toString();

    try {
      await navigator.clipboard.writeText(shareText);
      return true;
    } catch {
      window.prompt('Copy link:', shareText);
      return false;
    }
  };

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const tilesBaseUrl = process.env.NEXT_PUBLIC_TILES_BASE_URL;
  const reportIssueUrlTemplate = process.env.NEXT_PUBLIC_REPORT_ISSUE_URL_TEMPLATE;

  const pmtilesUrl = useMemo(() => {
    // If NEXT_PUBLIC_TILES_BASE_URL is set (local dev), use it.
    // Otherwise (static hosting), serve PMTiles from this site under basePath.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const root = tilesBaseUrl ?? `${origin}${basePath}`;
    return `${root}/basemap-seattle.pmtiles`;
  }, [basePath, tilesBaseUrl]);

  const sketchinessUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const root = tilesBaseUrl ?? `${origin}${basePath}`;
    return `${root}/sketchiness.pmtiles`;
  }, [basePath, tilesBaseUrl]);

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

    const initialViewport = parseInitialViewportFromUrl();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: initialViewport ? ([initialViewport.lng, initialViewport.lat] as [number, number]) : SEATTLE_CENTER,
      zoom: initialViewport ? initialViewport.zoom : 11,
      minZoom: 2,
      maxZoom: 20,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    mapRef.current = map;

    const buildFeatureInfoFromProps = (props: maplibregl.GeoJSONFeature['properties'], coordinates: maplibregl.LngLat) => {
      if (!props) return null;

      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

      let displayName = props.name;
      const highwayType = props.highway ? capitalize(props.highway) : 'Unknown Type';
      const isResidential = props.highway === 'residential';

      if (!displayName) {
        displayName = `${highwayType} Road`;
      }

      const distanceMeters =
        typeof props.dist_to_crossing_meters === 'number' ? Math.round(props.dist_to_crossing_meters) : null;

      const latLng = `${coordinates.lat},${coordinates.lng}`;
      const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(latLng)}`;

      const osmViewUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
        String(coordinates.lat),
      )}&mlon=${encodeURIComponent(String(coordinates.lng))}#map=19/${encodeURIComponent(
        String(coordinates.lat),
      )}/${encodeURIComponent(String(coordinates.lng))}`;

      const googleFaviconUrl = 'https://www.google.com/s2/favicons?domain=google.com&sz=32';
      const osmFaviconUrl = 'https://www.google.com/s2/favicons?domain=openstreetmap.org&sz=32';

      const reportIssueUrl = reportIssueUrlTemplate ? buildReportIssueUrl(reportIssueUrlTemplate, coordinates, map.getZoom()) : null;

      return {
        title: displayName,
        highwayType,
        isResidential,
        distanceMeters,
        lngLat: coordinates,
        actions: [
          { href: streetViewUrl, label: 'Street View', iconUrl: googleFaviconUrl },
          { href: osmViewUrl, label: 'OSM', iconUrl: osmFaviconUrl },
        ],
        reportIssueUrl,
      } satisfies FeatureInfo;
    };

    const applyPinnedLocationFromUrl = () => {
      const pinned = parsePinnedParamsFromUrl();
      if (!pinned) return;

      const coordinates = pinned.lngLat;

      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker().setLngLat(coordinates).addTo(map);
      } else {
        markerRef.current.setLngLat(coordinates);
      }

      // Try to resolve the actual feature at this point so the info panel opens.
      const point = map.project(coordinates);
      const pad = 6;
      const features = map.queryRenderedFeatures(
        [
          [point.x - pad, point.y - pad],
          [point.x + pad, point.y + pad],
        ],
        { layers: [...SKETCHINESS_LAYER_IDS] },
      );

      if (features.length === 0) return;

      const info = buildFeatureInfoFromProps(features[0].properties, coordinates);
      if (!info) return;
      setSelected(info);
    };

    const syncUrlToMapViewport = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setUrlViewport({ lat: center.lat, lng: center.lng, zoom });
    };

    map.on('load', syncUrlToMapViewport);
    map.on('moveend', syncUrlToMapViewport);

    // If this URL was created via Share (pin=1), drop a marker (and select the feature if possible).
    map.once('idle', applyPinnedLocationFromUrl);

    // Add click handler for sketchiness lines
    const onSketchinessClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;
      
      if (!props) return;

      const lngLatLike = (e as unknown as { lngLat?: maplibregl.LngLatLike }).lngLat;
      if (!lngLatLike) return;
      const coordinates = maplibregl.LngLat.convert(lngLatLike);

      const info = buildFeatureInfoFromProps(props, coordinates);
      if (!info) return;

      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker().setLngLat(coordinates).addTo(map);
      } else {
        markerRef.current.setLngLat(coordinates);
      }

      setSelected(info);
    };

    for (const layerId of SKETCHINESS_LAYER_IDS) {
      map.on('click', layerId, onSketchinessClick);
    }

    // Change cursor on hover
    for (const layerId of SKETCHINESS_LAYER_IDS) {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    // Clear selection when clicking away from a feature.
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [...SKETCHINESS_LAYER_IDS],
      });
      if (features.length > 0) return;

      markerRef.current?.remove();
      markerRef.current = null;
      setSelected(null);
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;

      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, [style]);

  return (
    <div className={selected ? 'map-shell map-shell--has-selection' : 'map-shell'}>
      <div id="map" ref={mapContainerRef} />

      {selected ? <FeatureInfoPanel info={selected} onShare={handleShare} /> : null}

      <div className="map-overlay map-overlay--title" role="heading" aria-level={1}>
        Seattle Crosswalk Availability Map
      </div>

      <div className="map-overlay map-overlay--legend" aria-label="Legend">
        <div className="legend-title">Legend</div>
        <div className="legend-row">
          <span className="legend-line legend-line--green" />
          <span>0–100m to crossing (and residential streets)</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--yellow" />
          <span>100–200m</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--red" />
          <span>200–500m</span>
        </div>
        <div className="legend-row">
          <span className="legend-line legend-line--darkred" />
          <span>500m+</span>
        </div>
      </div>
    </div>
  );
}
