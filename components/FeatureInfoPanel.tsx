'use client';

import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

type ActionLink = {
  href: string;
  label: string;
  iconUrl?: string;
};

export type FeatureInfo = {
  title: string;
  highwayType: string;
  isResidential: boolean;
  distanceMeters?: number | null;
  lngLat: maplibregl.LngLat;
  actions: ActionLink[];
  reportIssueUrl?: string | null;
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid rgba(0, 0, 0, 0.12)',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  background: 'rgba(255, 255, 255, 0.92)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

const iconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  flex: '0 0 auto',
  objectFit: 'contain',
  display: 'block',
};

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: '1px solid rgba(0, 0, 0, 0.12)',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.92)',
  color: 'inherit',
  cursor: 'pointer',
};

export default function FeatureInfoPanel({
  info,
  onShare,
}: {
  info: FeatureInfo;
  onShare: () => Promise<boolean>;
}) {
  const [tooltip, setTooltip] = useState<'hidden' | 'copy' | 'copied' | 'failed'>('hidden');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const onShareClick = async () => {
    const ok = await onShare();
    setTooltip(ok ? 'copied' : 'failed');

    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setTooltip('hidden'), 1200);
  };

  return (
    <div className="map-overlay map-overlay--info" aria-label="Selected street">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{info.title}</div>
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button
              type="button"
              onClick={onShareClick}
              onMouseEnter={() => setTooltip('copy')}
              onMouseLeave={() => setTooltip('hidden')}
              aria-label="Copy link"
              title="Copy link"
              style={iconButtonStyle}
            >
              <i className="fa-solid fa-share-nodes" aria-hidden="true" />
            </button>

            <div
              style={{
                position: 'absolute',
                top: 34,
                right: 0,
                padding: '4px 6px',
                borderRadius: 6,
                border: '1px solid rgba(0, 0, 0, 0.12)',
                background: 'rgba(255, 255, 255, 0.92)',
                fontSize: 12,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                opacity: tooltip === 'hidden' ? 0 : 1,
                transform: tooltip === 'hidden' ? 'translateY(2px)' : 'translateY(0)',
                transition: 'opacity 120ms ease-out, transform 120ms ease-out',
              }}
            >
              {tooltip === 'copied' ? 'Copied!' : tooltip === 'failed' ? 'Copy failed' : 'Copy link'}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12 }}>
          <div>Type: {info.highwayType}</div>
          {!info.isResidential && typeof info.distanceMeters === 'number' ? (
            <div>
              Dist to Marked Crosswalk: <strong>{info.distanceMeters}m</strong>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'nowrap' }}>
          {info.actions.map((action) => (
            <a
              key={action.href}
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...buttonStyle, flex: '0 0 auto' }}
            >
              {action.iconUrl ? <img src={action.iconUrl} alt="" style={iconStyle} /> : null}
              {action.label}
            </a>
          ))}
        </div>

        {info.reportIssueUrl ? (
          <div style={{ marginTop: 4, fontSize: 12 }}>
            <a href={info.reportIssueUrl} target="_blank" rel="noopener noreferrer">
              Report an issue
            </a>
          </div>
        ) : null}

      </div>
    </div>
  );
}
