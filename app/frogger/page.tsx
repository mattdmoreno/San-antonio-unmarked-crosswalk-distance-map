'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';

type GameParams = {
  name: string;
  highway: string;
  lanes: number;
  speedMph: number | null;
  distToMarkedM: number | null;
  froggerIndex: number | null;
};

const LANE_H = 60;
const SAFE_H = 72;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseParams(sp: URLSearchParams): GameParams {
  const name = (sp.get('name') ?? '').trim();
  const highway = (sp.get('highway') ?? '').trim();

  const lanesRaw = Number(sp.get('lanes'));
  const lanes = clampInt(lanesRaw, 1, 8);

  const speedRaw = sp.get('speed');
  const speedMph = speedRaw != null && speedRaw !== '' ? Number(speedRaw) : null;
  const speedMphClean = typeof speedMph === 'number' && Number.isFinite(speedMph) ? clampNumber(speedMph, 1, 80) : null;

  const distRaw = sp.get('dist');
  const dist = distRaw != null && distRaw !== '' ? Number(distRaw) : null;
  const distClean = typeof dist === 'number' && Number.isFinite(dist) ? Math.max(0, dist) : null;

  const froggerIndexRaw = sp.get('fi');
  const fi = froggerIndexRaw != null && froggerIndexRaw !== '' ? Number(froggerIndexRaw) : null;
  const froggerIndex = typeof fi === 'number' && Number.isFinite(fi) ? clampNumber(fi, 0, 1) : null;

  return {
    name: name || 'Unknown street',
    highway: highway || 'Unknown type',
    lanes,
    speedMph: speedMphClean,
    distToMarkedM: distClean,
    froggerIndex,
  };
}

function froggerDifficultyLabel(froggerIndex: number | null): string {
  if (typeof froggerIndex !== 'number' || !Number.isFinite(froggerIndex)) return 'easy';
  if (froggerIndex < 0.2) return 'easy';
  if (froggerIndex < 0.4) return 'medium';
  if (froggerIndex < 0.6) return 'hard';
  return 'Ft. Lauderdale';
}

function formatRoadType(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Unknown';

  // Turn things like "primary" or "living_street" into "Primary" / "Living Street".
  const normalized = trimmed.replace(/_/g, ' ').replace(/\s{2,}/g, ' ');
  return normalized.replace(/\b\w/g, (m) => m.toUpperCase());
}

type Car = {
  laneIndex: number;
  x: number;
  width: number;
  speedPxPerSec: number;
  dir: 1 | -1;
};

type SpawnState = {
  t: number;
  nextSpawnByLane: number[];
  carSpeedPxPerSec: number;
};

function SpeedLimitSign({ speedMph }: { speedMph: number | null }) {
  const speedText = typeof speedMph === 'number' && Number.isFinite(speedMph) ? String(Math.round(speedMph)) : '?';

  return (
    <div
      style={{
        width: 110,
        border: '3px solid rgba(0, 0, 0, 0.85)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        padding: '8px 10px',
        textAlign: 'center',
        lineHeight: 1,
        userSelect: 'none',
      }}
      aria-label="Speed limit"
    >
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.8 }}>SPEED</div>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.8, marginTop: 2 }}>LIMIT</div>
      <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>{speedText}</div>
      <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>MPH</div>
    </div>
  );
}

function InfoList({
  lanes,
  roadType,
  froggerIndex,
  difficulty,
}: {
  lanes: number;
  roadType: string;
  froggerIndex: number | null;
  difficulty: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        fontSize: 14,
        fontWeight: 800,
        lineHeight: 1.15,
        minWidth: 220,
      }}
      aria-label="Road info"
    >
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Lanes:</span> {lanes}
      </div>
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Road type:</span> {roadType}
      </div>
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Frogger index:</span>{' '}
        {typeof froggerIndex === 'number' ? froggerIndex.toFixed(2) : '—'}
      </div>
      <div>
        <span style={{ color: 'rgba(0, 0, 0, 0.70)', fontWeight: 800 }}>Frogger difficulty:</span> {difficulty}
      </div>
    </div>
  );
}

function abbreviateStreetDirections(name: string): string {
  let out = name;

  // Handle combined directions first so we don't convert "Northwest" -> "Nwest".
  const combos: Array<[RegExp, string]> = [
    [/\b(north\s*-?\s*west|northwest)\b/gi, 'NW'],
    [/\b(north\s*-?\s*east|northeast)\b/gi, 'NE'],
    [/\b(south\s*-?\s*west|southwest)\b/gi, 'SW'],
    [/\b(south\s*-?\s*east|southeast)\b/gi, 'SE'],
  ];

  for (const [re, replacement] of combos) {
    out = out.replace(re, replacement);
  }

  const singles: Array<[RegExp, string]> = [
    [/\bnorth\b/gi, 'N'],
    [/\bsouth\b/gi, 'S'],
    [/\beast\b/gi, 'E'],
    [/\bwest\b/gi, 'W'],
  ];

  for (const [re, replacement] of singles) {
    out = out.replace(re, replacement);
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}

function StreetNameSign({ name }: { name: string }) {
  const displayName = abbreviateStreetDirections(name);
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px 22px',
        borderRadius: 10,
        border: '5px solid rgba(255, 255, 255, 0.95)',
        background: '#1b5e20',
        color: '#fff',
        fontSize: 26,
        fontWeight: 900,
        fontFamily: 'Overpass, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        letterSpacing: 0.2,
        lineHeight: 1,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 'min(680px, calc(100% - 24px))',
        boxShadow: '0 1px 0 rgba(0,0,0,0.10)',
        userSelect: 'none',
      }}
      aria-label="Street name"
    >
      {displayName}
    </div>
  );
}

function DistanceArrowInline({ meters }: { meters: number }) {
  const label = `${Math.round(meters)}m to nearest marked crosswalk`;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        fontSize: 13,
        fontWeight: 800,
        color: 'rgba(0, 0, 0, 0.80)',
        whiteSpace: 'nowrap',
      }}
      aria-label="Distance to nearest marked crosswalk"
      title={label}
    >
      <span>{label}</span>
      <svg width="120" height="14" viewBox="0 0 120 14" role="img" aria-label="Distance arrow">
        <defs>
          <marker id="arrowHeadSmall" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0,0 8,4 0,8" fill="#111" />
          </marker>
        </defs>
        <line x1="0" y1="7" x2="116" y2="7" stroke="#111" strokeWidth="2.5" markerEnd="url(#arrowHeadSmall)" />
      </svg>
    </div>
  );
}

export default function FroggerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const params = useMemo(() => parseParams(searchParams), [searchParams]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const animationRef = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);

  const carsRef = useRef<Car[]>([]);
  const playerRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 16, h: 16 });
  const spawnRef = useRef<SpawnState | null>(null);

  const [status, setStatus] = useState<'playing' | 'hit' | 'won'>('playing');
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const laneH = LANE_H;
    const safeH = SAFE_H;

    const randomSpawnDelaySec = (speedMph: number | null) => {
      // Faster streets feel "busier" by spawning slightly more often.
      const mph = typeof speedMph === 'number' && Number.isFinite(speedMph) ? speedMph : 25;
      const base = clampNumber(1.6 - mph / 80, 0.7, 1.6);
      return base * (0.6 + Math.random() * 0.9);
    };

    const resize = () => {
      const width = Math.max(280, Math.min(720, Math.floor(container.getBoundingClientRect().width)));
      const height = safeH + params.lanes * laneH + safeH;
      canvas.width = width;
      canvas.height = height;

      // Reset player position whenever size/params change.
      playerRef.current.w = 22;
      playerRef.current.h = 22;
      playerRef.current.x = Math.floor(width / 2 - playerRef.current.w / 2);
      playerRef.current.y = height - safeH + Math.floor((safeH - playerRef.current.h) / 2);

      // Re-seed cars.
      const assumedSpeed = params.speedMph ?? 25;
      // Map MPH -> px/s: 25mph ≈ 140px/s, clamped.
      const basePx = clampNumber((assumedSpeed / 25) * 170, 80, 520);

      carsRef.current = [];
      spawnRef.current = {
        t: 0,
        nextSpawnByLane: Array.from({ length: params.lanes }, () => randomSpawnDelaySec(params.speedMph)),
        carSpeedPxPerSec: basePx,
      };
      setStatus('playing');
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [params.lanes, params.speedMph, resetToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const laneH = LANE_H;
    const safeH = SAFE_H;

    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key.startsWith('Arrow')) evt.preventDefault();

      if (status !== 'playing') {
        // Any key restarts (ignore pure modifier keys).
        if (evt.key !== 'Shift' && evt.key !== 'Alt' && evt.key !== 'Control' && evt.key !== 'Meta') {
          setResetToken((t) => t + 1);
        }
        return;
      }

      const p = playerRef.current;
      const stepX = 26;
      const stepY = 26;

      let dx = 0;
      let dy = 0;

      const key = evt.key.toLowerCase();
      if (evt.key === 'ArrowLeft' || key === 'a') dx = -stepX;
      if (evt.key === 'ArrowRight' || key === 'd') dx = stepX;
      if (evt.key === 'ArrowUp' || key === 'w') dy = -stepY;
      if (evt.key === 'ArrowDown' || key === 's') dy = stepY;

      if (!dx && !dy) return;

      p.x += dx;
      p.y += dy;

      p.x = clampNumber(p.x, 0, canvas.width - p.w);
      p.y = clampNumber(p.y, 0, canvas.height - p.h);

      // Win condition: reach the top safe zone.
      if (p.y <= Math.floor((safeH - p.h) / 2)) {
        setStatus('won');
      }
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown as any);
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const laneH = LANE_H;
    const safeH = SAFE_H;

    const tick = (t: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const lastT = lastTRef.current;
      lastTRef.current = t;
      const dt = typeof lastT === 'number' ? Math.min(0.05, (t - lastT) / 1000) : 0;

      // Background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Safe zones
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillRect(0, 0, canvas.width, safeH);
      ctx.fillRect(0, canvas.height - safeH, canvas.width, safeH);

      // Road
      const roadY = safeH;
      const roadH = params.lanes * laneH;
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(0, roadY, canvas.width, roadH);

      // Lane lines
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      for (let i = 1; i < params.lanes; i++) {
        const y = roadY + i * laneH;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Double center line
      if (params.lanes >= 2) {
        // Put the divider between the two directions of travel.
        // If the lane count is odd, bias so the top half has fewer lanes.
        // Example: 5 lanes => 2 lanes above the divider, 3 below.
        const dividerY = roadY + Math.floor(params.lanes / 2) * laneH;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, dividerY - 5);
        ctx.lineTo(canvas.width, dividerY - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, dividerY + 5);
        ctx.lineTo(canvas.width, dividerY + 5);
        ctx.stroke();
      }

      // Spawn cars at random times
      if (status === 'playing' && dt > 0) {
        const spawn = spawnRef.current;
        if (spawn) {
          spawn.t += dt;

          for (let laneIndex = 0; laneIndex < params.lanes; laneIndex++) {
            if (spawn.t < spawn.nextSpawnByLane[laneIndex]) continue;

            const dir: 1 | -1 = laneIndex % 2 === 0 ? 1 : -1;
            const widthVar = 70 + Math.floor(Math.random() * 50);
            const startX = dir === 1 ? -widthVar - 10 : canvas.width + widthVar + 10;
            carsRef.current.push({
              laneIndex,
              x: startX,
              width: widthVar,
              speedPxPerSec: spawn.carSpeedPxPerSec,
              dir,
            });

            const mph = params.speedMph ?? 25;
            const base = clampNumber(1.6 - mph / 80, 0.7, 1.6);
            spawn.nextSpawnByLane[laneIndex] = spawn.t + base * (0.6 + Math.random() * 0.9);
          }
        }
      }

      // Cars
      const cars = carsRef.current;
      if (status === 'playing' && dt > 0 && cars.length) {
        for (const car of cars) {
          car.x += car.dir * car.speedPxPerSec * dt;
        }

        // Drop cars that are well offscreen.
        carsRef.current = cars.filter((car) => !(car.x < -car.width - 120 || car.x > canvas.width + car.width + 120));
      }

      for (const car of carsRef.current) {

        const yCenter = roadY + car.laneIndex * laneH + laneH / 2;
        const carH = 22;
        const carY = Math.floor(yCenter - carH / 2);

        ctx.fillStyle = '#e53935';
        ctx.fillRect(Math.floor(car.x), carY, car.width, carH);
      }

      // Player
      const p = playerRef.current;
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.w, p.h);

      // Collision
      if (status === 'playing') {
        const px1 = p.x;
        const py1 = p.y;
        const px2 = p.x + p.w;
        const py2 = p.y + p.h;

        for (const car of carsRef.current) {
          const yCenter = roadY + car.laneIndex * laneH + laneH / 2;
          const carH = 18;
          const carY1 = yCenter - carH / 2;
          const carY2 = carY1 + carH;
          const carX1 = car.x;
          const carX2 = car.x + car.width;

          const hit = px1 < carX2 && px2 > carX1 && py1 < carY2 && py2 > carY1;
          if (hit) {
            setStatus('hit');
            break;
          }
        }
      }

      // Overlay text
      ctx.fillStyle = '#111';
      ctx.font = 'bold 14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillText('Goal: reach the top sidewalk', 14, 22);

      if (status === 'hit') {
        ctx.fillStyle = '#e53935';
        ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Hit! Press any key to restart.', 14, canvas.height - 18);
      }
      if (status === 'won') {
        ctx.fillStyle = '#4caf50';
        ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Made it! Press any key to play again.', 14, canvas.height - 18);
      }

      animationRef.current = window.requestAnimationFrame(tick);
    };

    animationRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      lastTRef.current = null;
    };
  }, [params.lanes, params.speedMph, status]);

  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  const onReset = () => {
    setResetToken((t) => t + 1);
  };

  const difficulty = froggerDifficultyLabel(params.froggerIndex);
  const roadType = formatRoadType(params.highway);

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: 12,
        background: '#f8f8f8',
        color: '#111',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: 'min(960px, 100%)',
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 8,
          padding: '14px 16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.92)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 800,
                lineHeight: 1.1,
              }}
              aria-label="Back to map"
            >
              <i className="fa-solid fa-arrow-left" aria-hidden="true" />
              Back to map
            </button>

            <button
              type="button"
              onClick={onReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                border: '1px solid rgba(0, 0, 0, 0.12)',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.92)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 800,
                lineHeight: 1.1,
              }}
              aria-label="Reset"
            >
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
              Reset
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SpeedLimitSign speedMph={params.speedMph} />
            <InfoList lanes={params.lanes} roadType={roadType} froggerIndex={params.froggerIndex} difficulty={difficulty} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }} />
        </div>

        <div style={{ marginTop: 10, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: SAFE_H,
              transform: 'translateY(-50%)',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          >
            <StreetNameSign name={params.name} />
          </div>

          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              borderRadius: 8,
              border: '1px solid rgba(0, 0, 0, 0.12)',
              background: '#f8f8f8',
            }}
            aria-label="Frogger game"
          />
        </div>

        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0, 0, 0, 0.75)' }}>
            Controls: arrow keys or WASD. Press any key to restart.
          </div>
          {typeof params.distToMarkedM === 'number' ? <DistanceArrowInline meters={params.distToMarkedM} /> : null}
        </div>
      </div>
    </div>
  );
}
