import { dist, type Point } from './geometry';

export interface GroupStats {
  count: number;
  /** Largest center-to-center distance between two shots (mm). */
  extremeSpread: number;
  /** Indices of the two shots that define the extreme spread. */
  extremeSpreadPair: [number, number] | null;
  /** Extreme spread + caliber: the "outside-to-outside" measurement (mm). */
  outsideToOutside: number;
  /** Horizontal / vertical extent, center-to-center (mm). */
  width: number;
  height: number;
  /** Mean point of impact (mm from aim point, y down). */
  center: Point;
  /** Average distance from the group center (mm). */
  meanRadius: number;
  /** Distance from the group center to the farthest shot (mm). */
  maxRadius: number;
  /** Distance of the group center from the aim point (mm). */
  offsetDistance: number;
}

export function groupStats(shots: Point[], caliberMm: number): GroupStats {
  const n = shots.length;
  if (n === 0) {
    return {
      count: 0,
      extremeSpread: 0,
      extremeSpreadPair: null,
      outsideToOutside: 0,
      width: 0,
      height: 0,
      center: { x: 0, y: 0 },
      meanRadius: 0,
      maxRadius: 0,
      offsetDistance: 0,
    };
  }

  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of shots) {
    sx += p.x;
    sy += p.y;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const center = { x: sx / n, y: sy / n };

  let es = 0;
  let pair: [number, number] | null = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dist(shots[i], shots[j]);
      if (d > es) {
        es = d;
        pair = [i, j];
      }
    }
  }

  let sumR = 0;
  let maxR = 0;
  for (const p of shots) {
    const r = dist(p, center);
    sumR += r;
    maxR = Math.max(maxR, r);
  }

  return {
    count: n,
    extremeSpread: es,
    extremeSpreadPair: pair,
    outsideToOutside: n >= 2 ? es + caliberMm : caliberMm,
    width: maxX - minX,
    height: maxY - minY,
    center,
    meanRadius: sumR / n,
    maxRadius: maxR,
    offsetDistance: Math.hypot(center.x, center.y),
  };
}
