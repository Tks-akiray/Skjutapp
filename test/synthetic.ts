import type { CV, RGBAImage } from '../src/vision/cv';
import type { Point } from '../src/analysis/geometry';
import { ringDiameter, scoringDiameter, type RingTarget } from '../src/targets/definitions';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAPER = 232;
const INK = 18;
const BACKING = 115; // what shows through a hole

interface DrawOpts {
  pxPerMm: number;
  caliberMm: number;
  shots: Point[]; // mm from center, y down
  seed?: number;
}

/** A flat (unwarped) ring target, centered, with numbers and holes. */
export function drawRingTarget(cv: CV, t: RingTarget, o: DrawOpts) {
  const sizeMm = scoringDiameter(t) + 60;
  const S = Math.round(sizeMm * o.pxPerMm);
  const c = S / 2;
  const img = new cv.Mat(S, S, cv.CV_8UC1, new cv.Scalar(PAPER));
  const P = (x: number, y: number) => new cv.Point(Math.round(c + x * o.pxPerMm), Math.round(c + y * o.pxPerMm));
  const blackR = (t.blackDiameterMm / 2) * o.pxPerMm;
  cv.circle(img, P(0, 0), Math.round(blackR), new cv.Scalar(INK), -1);

  const lineT = Math.max(1, Math.round(0.25 * o.pxPerMm));
  for (let ring = t.lowestRing; ring <= 10; ring++) {
    const r = (ringDiameter(t, ring) / 2) * o.pxPerMm;
    const color = r < blackR - 1 ? 215 : INK;
    cv.circle(img, P(0, 0), Math.round(r), new cv.Scalar(color), lineT);
  }
  // Ring numbers on the white part, left and right of center.
  const textH = (t.ringStepMm / 2) * 0.45;
  for (let ring = t.lowestRing; ring < 10; ring++) {
    const rMid = (ringDiameter(t, ring) + ringDiameter(t, ring + 1)) / 4;
    if (rMid < t.blackDiameterMm / 2) continue;
    const scale = (textH * o.pxPerMm) / 22;
    const th = Math.max(1, Math.round(0.08 * textH * o.pxPerMm));
    for (const sx of [-1, 1]) {
      cv.putText(img, String(ring), P(sx * rMid - textH * 0.3, textH * 0.5), cv.FONT_HERSHEY_SIMPLEX, scale, new cv.Scalar(INK), th);
    }
  }

  drawHoles(cv, img, o, c);
  return { mat: img, centerPx: { x: c, y: c } };
}

/** A sheet of grid paper with `squareMm` squares; origin of shot coordinates = sheet center. */
export function drawGridTarget(cv: CV, widthMm: number, heightMm: number, squareMm: number, o: DrawOpts) {
  const W = Math.round(widthMm * o.pxPerMm);
  const H = Math.round(heightMm * o.pxPerMm);
  const img = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(PAPER));
  const lineT = Math.max(1, Math.round(0.3 * o.pxPerMm));
  for (let x = 0; x <= widthMm; x += squareMm) {
    cv.line(img, new cv.Point(Math.round(x * o.pxPerMm), 0), new cv.Point(Math.round(x * o.pxPerMm), H), new cv.Scalar(150), lineT);
  }
  for (let y = 0; y <= heightMm; y += squareMm) {
    cv.line(img, new cv.Point(0, Math.round(y * o.pxPerMm)), new cv.Point(W, Math.round(y * o.pxPerMm)), new cv.Scalar(150), lineT);
  }
  const center = { x: W / 2, y: H / 2 };
  drawHoles(cv, img, o, center.x, center.y);
  return { mat: img, centerPx: center };
}

function drawHoles(cv: CV, img: InstanceType<CV['Mat']>, o: DrawOpts, cx: number, cy = cx) {
  const rand = rng(o.seed ?? 1);
  for (const s of o.shots) {
    // Paper closes up a little around the hole and the edge is ragged.
    const r = (o.caliberMm / 2) * o.pxPerMm * (0.88 + 0.08 * rand());
    const n = 18;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.9 + 0.2 * rand());
      pts.push(Math.round(cx + s.x * o.pxPerMm + rr * Math.cos(a)), Math.round(cy + s.y * o.pxPerMm + rr * Math.sin(a)));
    }
    const poly = cv.matFromArray(n, 1, cv.CV_32SC2, pts);
    const vec = new cv.MatVector();
    vec.push_back(poly);
    cv.fillPoly(img, vec, new cv.Scalar(BACKING + Math.round((rand() - 0.5) * 20)));
    poly.delete();
    vec.delete();
  }
}

/**
 * Put a flat target into a "photo": perspective warp with jittered corners, a table
 * background, blur, noise and an illumination gradient. Returns the RGBA photo and the
 * homography (flat px → photo px) so tests can map known points.
 */
export function photograph(cv: CV, flat: InstanceType<CV['Mat']>, seed: number, skew = 0.04) {
  const rand = rng(seed);
  const w = flat.cols;
  const h = flat.rows;
  const W = Math.round(w * 1.3);
  const H = Math.round(h * 1.2);
  const ox = (W - w) / 2;
  const oy = (H - h) / 2;
  const j = () => (rand() - 0.5) * 2 * skew * Math.max(w, h);
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const dstArr = [ox + j(), oy + j(), ox + w + j(), oy + j(), ox + w + j(), oy + h + j(), ox + j(), oy + h + j()];
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, dstArr);
  const Hm = cv.getPerspectiveTransform(src, dst);
  const warped = new cv.Mat();
  cv.warpPerspective(flat, warped, Hm, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(70));

  // Lighting gradient + noise.
  const d = warped.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = 0.85 + 0.15 * (x / W) + (rand() - 0.5) * 0.06;
      d[y * W + x] = Math.max(0, Math.min(255, d[y * W + x] * g));
    }
  }
  cv.GaussianBlur(warped, warped, new cv.Size(3, 3), 0);

  const rgba = new cv.Mat();
  cv.cvtColor(warped, rgba, cv.COLOR_GRAY2RGBA);
  const image: RGBAImage = { data: new Uint8ClampedArray(rgba.data), width: W, height: H };
  const hData = Array.from(Hm.data64F);
  [src, dst, Hm, warped, rgba].forEach((m) => m.delete());

  const map = (p: Point): Point => {
    const [a, b, c, d2, e, f, g, hh, i] = hData;
    const z = g * p.x + hh * p.y + i;
    return { x: (a * p.x + b * p.y + c) / z, y: (d2 * p.x + e * p.y + f) / z };
  };
  return { image, map };
}

/** Greedy nearest matching of detections to truth. */
export function matchPoints(truth: Point[], found: Point[], tol: number) {
  const used = new Set<number>();
  const errors: number[] = [];
  let matched = 0;
  for (const t of truth) {
    let bi = -1;
    let bd = Infinity;
    found.forEach((f, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(f.x - t.x, f.y - t.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (bi >= 0 && bd <= tol) {
      used.add(bi);
      matched++;
      errors.push(bd);
    }
  }
  return { matched, falsePositives: found.length - used.size, maxError: Math.max(0, ...errors) };
}
