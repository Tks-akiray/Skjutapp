import type { Point } from './geometry';

/**
 * Projective map from the unit square to a quad (TL, TR, BR, BL), for drawing the assumed
 * grid inside the marked area (Heckbert's square-to-quad).
 */
export function squareToQuad([p0, p1, p2, p3]: [Point, Point, Point, Point]) {
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return (u: number, v: number): Point => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/** Order 4 points as TL, TR, BR, BL regardless of tap order. */
export function orderQuad(pts: Point[]): [Point, Point, Point, Point] {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // Angles sorted from -π: starts near top-left. Rotate so the first is the smallest x+y.
  let first = 0;
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[first].x + sorted[first].y) first = i;
  });
  const r = [...sorted.slice(first), ...sorted.slice(0, first)];
  return [r[0], r[1], r[2], r[3]];
}
