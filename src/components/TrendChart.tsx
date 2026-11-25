import { useEffect, useMemo, useRef, useState } from 'react';

export interface TrendPoint {
  t: number; // timestamp
  value: number;
  /** Secondary text for the tooltip (e.g. target and distance). */
  detail: string;
}

interface Props {
  points: TrendPoint[]; // chronological
  format: (v: number) => string;
  /** Accessible description of what's plotted. */
  label: string;
}

const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/** Single-series line chart over sessions (evenly spaced, oldest → newest). */
export function TrendChart({ points, format, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const max = useMemo(() => niceMax(Math.max(0, ...points.map((p) => p.value)) * 1.05), [points]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const iw = Math.max(10, w - PAD.left - PAD.right);
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else return;
    e.preventDefault();
  };

  const a = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 80), w - 80) : 0;

  return (
    <div className="trend" ref={wrapRef}>
      <svg
        width={w}
        height={H}
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((v) => v ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {n > 0 && (
          <>
            <text className="tick" x={x(0)} y={H - 8} textAnchor={n > 1 ? 'start' : 'middle'}>
              {date(points[0].t)}
            </text>
            {n > 1 && (
              <text className="tick" x={x(n - 1)} y={H - 8} textAnchor="end">
                {date(points[n - 1].t)}
              </text>
            )}
          </>
        )}
        {active !== null && <line className="crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + ih} />}
        <path className="series" d={path} />
        {points.map((p, i) => (
          <circle key={i} className={i === active ? 'dot active' : 'dot'} cx={x(i)} cy={y(p.value)} r={i === active ? 5.5 : 4} />
        ))}
        {n > 0 && (
          <text className="end-label" x={x(n - 1)} y={y(points[n - 1].value) - 12} textAnchor={n > 1 ? 'end' : 'middle'}>
            {format(points[n - 1].value)}
          </text>
        )}
      </svg>
      {a && (
        <div className="tooltip" style={{ left: tipLeft }} role="status">
          <strong>{format(a.value)}</strong>
          <span>{new Date(a.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          <span>{a.detail}</span>
        </div>
      )}
    </div>
  );
}
