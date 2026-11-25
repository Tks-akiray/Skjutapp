import type { Point } from './geometry';
import { ringDiameter, type RingTarget } from '../targets/definitions';

export interface ShotScore {
  /** Integer ring value (0 = miss). */
  ring: number;
  /** Inner ten (X). */
  x: boolean;
  /** Decimal value (10.9 max), approximated from ring geometry. 0 for a miss. */
  decimal: number;
}

export interface ScoreSummary {
  total: number;
  decimalTotal: number;
  xCount: number;
  shots: ShotScore[];
}

const EPS = 1e-9;

/**
 * Score one shot. A shot gets the higher value if the hole touches the outer edge
 * of the ring, so we compare the distance from the center minus the bullet radius
 * against each ring's radius.
 */
export function scoreShot(target: RingTarget, p: Point, caliberMm: number): ShotScore {
  const edge = Math.hypot(p.x, p.y) - caliberMm / 2;
  const r10 = target.tenDiameterMm / 2;
  const w = target.ringStepMm / 2;

  let ring = 0;
  if (edge <= r10 + EPS) {
    ring = 10;
  } else {
    ring = 10 - Math.ceil((edge - r10) / w - EPS);
    if (ring < target.lowestRing) ring = 0;
  }

  const x = edge <= target.innerTenDiameterMm / 2 + EPS;

  let decimal = 0;
  if (ring > 0) {
    // Each ring is divided into tenths: touching the 10-ring edge = 10.0, center = 10.9.
    const raw = 11 - (edge - r10 + w) / w;
    decimal = Math.min(10.9, Math.floor(raw * 10 + EPS) / 10);
    // Keep the decimal value consistent with the integer ring.
    decimal = Math.max(ring, Math.min(decimal, ring + 0.9));
  }

  return { ring, x, decimal };
}

export function scoreShots(target: RingTarget, shots: Point[], caliberMm: number): ScoreSummary {
  const scored = shots.map((p) => scoreShot(target, p, caliberMm));
  return {
    total: scored.reduce((s, r) => s + r.ring, 0),
    decimalTotal: Math.round(scored.reduce((s, r) => s + r.decimal, 0) * 10) / 10,
    xCount: scored.filter((r) => r.x).length,
    shots: scored,
  };
}

/** Radii (mm) of all ring lines, for drawing overlays. */
export const ringRadii = (t: RingTarget): { ring: number; r: number }[] => {
  const out: { ring: number; r: number }[] = [];
  for (let ring = t.lowestRing; ring <= 10; ring++) out.push({ ring, r: ringDiameter(t, ring) / 2 });
  return out;
};
