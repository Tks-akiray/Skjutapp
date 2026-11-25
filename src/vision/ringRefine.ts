import type { CV } from './cv';
import type { Point } from '../analysis/geometry';
import { ringDiameter, type RingTarget } from '../targets/definitions';

type Mat3 = number[]; // row-major 3×3

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface RingFeature {
  /** Radius in mm. */
  r: number;
  /** dark = dark line on white, light = light line on black, edge = black→white edge. */
  kind: 'dark' | 'light' | 'edge';
  /** Half search window (mm), kept clear of neighboring features. */
  window: number;
}

export interface RingFit {
  /** Homography: rectified px → target mm. */
  H: Mat3;
  rmsMm: number;
  points: number;
}

/** The circles we can measure on a ring target: ring lines and the edge of the black. */
export function ringFeatures(t: RingTarget): RingFeature[] {
  const blackR = t.blackDiameterMm / 2;
  const raw: Omit<RingFeature, 'window'>[] = [{ r: blackR, kind: 'edge' }];
  for (let ring = t.lowestRing; ring <= 10; ring++) {
    const r = ringDiameter(t, ring) / 2;
    if (Math.abs(r - blackR) < 1) continue; // ring line coincides with the black edge
    raw.push({ r, kind: r < blackR ? 'light' : 'dark' });
  }
  raw.sort((a, b) => a.r - b.r);
  return raw.map((f, i) => {
    const gaps = [raw[i - 1] ? f.r - raw[i - 1].r : f.r, raw[i + 1] ? raw[i + 1].r - f.r : Infinity];
    return { ...f, window: 0.45 * Math.min(...gaps) };
  });
}

export const mul3 = (A: Mat3, B: Mat3): Mat3 => {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return out;
};

export const apply3 = (H: Mat3, p: Point): Point => {
  const z = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / z, y: (H[3] * p.x + H[4] * p.y + H[5]) / z };
};

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

function bilinear(img: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width - 1 || y >= img.height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * img.width + x0;
  const d = img.data;
  return (
    d[i] * (1 - fx) * (1 - fy) + d[i + 1] * fx * (1 - fy) + d[i + img.width] * (1 - fx) * fy + d[i + img.width + 1] * fx * fy
  );
}

/** Sub-sample position of an extremum from its neighbors (parabola fit). */
const parabola = (a: number, b: number, c: number) => {
  const den = a - 2 * b + c;
  return den === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
};

/** Find a feature along a profile; returns the offset index (fractional) or null. */
function locate(profile: number[], kind: RingFeature['kind']): number | null {
  const n = profile.length;
  if (n < 7 || profile.some(Number.isNaN)) return null;
  const sorted = [...profile].sort((a, b) => a - b);
  const median = sorted[n >> 1];

  if (kind === 'edge') {
    // Strongest dark→light step going outward; derivative over ±2 samples (±1 px).
    let best = -1;
    let bestD = 0;
    const d = (i: number) => profile[i + 2] - profile[i - 2];
    for (let i = 2; i < n - 2; i++) {
      if (d(i) > bestD) {
        bestD = d(i);
        best = i;
      }
    }
    if (best < 3 || best > n - 4 || bestD < 30) return null;
    const inside = profile.slice(0, best - 2);
    const outside = profile.slice(best + 3);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    if (mean(outside) - mean(inside) < 50) return null;
    return best + parabola(d(best - 1), d(best), d(best + 1));
  }

  const sign = kind === 'dark' ? -1 : 1;
  let best = -1;
  let bestV = -Infinity;
  for (let i = 0; i < n; i++) {
    if (sign * profile[i] > bestV) {
      bestV = sign * profile[i];
      best = i;
    }
  }
  if (best < 1 || best > n - 2) return null;
  if (bestV - sign * median < 25) return null;
  return best + parabola(sign * profile[best - 1], sign * profile[best], sign * profile[best + 1]);
}

/** Collect ring-line points along rays, given the current model H (px → mm). */
function collectPoints(gray: GrayImage, H: Mat3, features: RingFeature[], rays = 180) {
  const Hinv = invert3(H);
  const cPx = apply3(Hinv, { x: 0, y: 0 });
  const step = 0.5;
  const pts: { p: Point; r: number }[] = [];
  for (let k = 0; k < rays; k++) {
    const ang = (2 * Math.PI * k) / rays;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    for (const f of features) {
      const pp = apply3(Hinv, { x: f.r * ux, y: f.r * uy });
      const dx = pp.x - cPx.x;
      const dy = pp.y - cPx.y;
      const len = Math.hypot(dx, dy);
      const dir = { x: dx / len, y: dy / len };
      const win = f.window * (len / f.r);
      const profile: number[] = [];
      for (let t = -win; t <= win; t += step) profile.push(bilinear(gray, pp.x + dir.x * t, pp.y + dir.y * t));
      const idx = locate(profile, f.kind);
      if (idx === null) continue;
      const t = -win + idx * step;
      pts.push({ p: { x: pp.x + dir.x * t, y: pp.y + dir.y * t }, r: f.r });
    }
  }
  return pts;
}

/** Solve A·x = b (n×n, Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-15) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let j = r + 1; j < n; j++) v -= M[r][j] * x[j];
    x[r] = v / M[r][r];
  }
  return x;
}

/**
 * Levenberg–Marquardt fit of a correction homography C (normalized mm → mm, C = I + δ)
 * minimizing Σ (|C(q_i)| − r_i)², where q_i are points mapped by the current model.
 * A weak term keeps the in-plane rotation unchanged (circles don't define it).
 */
function fitCorrection(q: Point[], r: number[], scale: number): Mat3 | null {
  const n = q.length;
  let x = new Array(8).fill(0); // δ for h00 h01 h02 h10 h11 h12 h20 h21
  const toH = (v: number[]): Mat3 => [1 + v[0], v[1], v[2], v[3], 1 + v[4], v[5], v[6], v[7], 1];
  const ROT_W = 50;
  const residuals = (v: number[]) => {
    const H = toH(v);
    const e = new Array(n + 1);
    for (let i = 0; i < n; i++) {
      const m = apply3(H, q[i]);
      e[i] = Math.hypot(m.x, m.y) * scale - r[i];
    }
    e[n] = ROT_W * (v[1] - v[3]) * scale;
    return e;
  };
  const cost = (e: number[]) => e.reduce((s, v) => s + v * v, 0);

  let e = residuals(x);
  let c = cost(e);
  let mu = 1e-3;
  for (let it = 0; it < 50; it++) {
    // Numeric Jacobian.
    const J: number[][] = [];
    const h = 1e-6;
    for (let j = 0; j < 8; j++) {
      const xp = [...x];
      xp[j] += h;
      const ep = residuals(xp);
      J.push(ep.map((v, i) => (v - e[i]) / h));
    }
    const JtJ = Array.from({ length: 8 }, (_, a) => Array.from({ length: 8 }, (_, b) => {
      let sum = 0;
      for (let i = 0; i <= n; i++) sum += J[a][i] * J[b][i];
      return sum;
    }));
    const Jte = Array.from({ length: 8 }, (_, a) => {
      let sum = 0;
      for (let i = 0; i <= n; i++) sum += J[a][i] * e[i];
      return -sum;
    });
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + mu) + 1e-12 : v)));
      const d = solve(A, Jte);
      if (!d) break;
      const xn = x.map((v, j) => v + d[j]);
      const en = residuals(xn);
      const cn = cost(en);
      if (cn < c) {
        x = xn;
        e = en;
        const rel = (c - cn) / c;
        c = cn;
        mu = Math.max(1e-9, mu / 3);
        improved = rel > 1e-10;
        break;
      }
      mu *= 4;
    }
    if (!improved) break;
  }
  return toH(x);
}

/**
 * Fit a homography (rectified px → mm) to ring lines and the black edge found along rays
 * from the center. `pxPerMm` and `center` describe the current approximate rectification.
 */
export function refineFromRings(
  _cv: CV,
  gray: GrayImage,
  pxPerMm: number,
  center: Point,
  target: RingTarget,
  rounds = 3,
): RingFit | null {
  const maxR = Math.min(gray.width, gray.height) / 2 / pxPerMm - 2;
  const features = ringFeatures(target).filter((f) => f.r + f.window < maxR && f.r > 3);
  const H0: Mat3 = [1 / pxPerMm, 0, -center.x / pxPerMm, 0, 1 / pxPerMm, -center.y / pxPerMm, 0, 0, 1];
  let H = H0;
  const s = target.blackDiameterMm / 2; // normalization scale (mm)
  const D = (k: number): Mat3 => [k, 0, 0, 0, k, 0, 0, 0, 1];
  let fit: RingFit | null = null;

  for (let round = 0; round < rounds; round++) {
    const pts = collectPoints(gray, H, features);
    if (pts.length < 24) return fit;

    // Map with the current model, normalize, fit, then reject outliers and refit.
    let use = pts;
    let C: Mat3 | null = null;
    for (let pass = 0; pass < 2; pass++) {
      const q = use.map((o) => {
        const m = apply3(H, o.p);
        return { x: m.x / s, y: m.y / s };
      });
      C = fitCorrection(q, use.map((o) => o.r), s);
      if (!C) return fit;
      const Hn = mul3(D(s), mul3(C, mul3(D(1 / s), H)));
      const res = use.map((o) => Math.abs(Math.hypot(...Object.values(apply3(Hn, o.p))) - o.r));
      const sorted = [...res].sort((a, b) => a - b);
      const cut = Math.max(0.1, 3 * 1.4826 * sorted[sorted.length >> 1]);
      if (pass === 0) use = use.filter((_, i) => res[i] <= cut);
    }
    const Hn = mul3(D(s), mul3(C!, mul3(D(1 / s), H)));

    // Sanity: the refined model must stay close to the initial one.
    const c2 = apply3(invert3(Hn), { x: 0, y: 0 });
    const blackRpx = s * pxPerMm;
    if (Math.hypot(c2.x - center.x, c2.y - center.y) > 0.15 * blackRpx) return fit;
    const edge = apply3(invert3(Hn), { x: s, y: 0 });
    const rr = Math.hypot(edge.x - c2.x, edge.y - c2.y) / blackRpx;
    if (rr < 0.8 || rr > 1.25) return fit;

    const res = use.map((o) => Math.hypot(...Object.values(apply3(Hn, o.p))) - o.r);
    const rms = Math.sqrt(res.reduce((a, v) => a + v * v, 0) / res.length);
    if (use.length < 24) return fit;
    H = Hn;
    fit = { H, rmsMm: rms, points: use.length };
  }
  return fit;
}
