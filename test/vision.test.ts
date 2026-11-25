import { beforeAll, describe, expect, it } from 'vitest';
import { loadCvNode } from './cvNode';
import { drawGridTarget, drawRingTarget, matchPoints, photograph, rng } from './synthetic';
import type { CV } from '../src/vision/cv';
import { findAimMark, fitCircle, rectifyByQuad, rectifyRingTarget } from '../src/vision/rectify';
import { blobPeaks, detectHoles } from '../src/vision/detectHoles';
import { mmToPx, pxToMm, type Point } from '../src/analysis/geometry';
import type { RGBAImage } from '../src/vision/cv';
import { writeFileSync } from 'node:fs';
import { getTarget, scoringDiameter, type RingTarget } from '../src/targets/definitions';

let cv: CV;
beforeAll(async () => {
  cv = await loadCvNode();
});

function randomShots(seed: number, n: number, maxR: number, minSep: number): Point[] {
  const rand = rng(seed);
  const out: Point[] = [];
  while (out.length < n) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * maxR;
    const p = { x: r * Math.cos(a), y: r * Math.sin(a) };
    if (out.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > minSep)) out.push(p);
  }
  return out;
}

function runRing(target: RingTarget, pxPerMm: number, caliberMm: number, shots: Point[], seed: number, refine = true) {
  const flat = drawRingTarget(cv, target, { pxPerMm, caliberMm, shots, seed });
  const photo = photograph(cv, flat.mat, seed);
  flat.mat.delete();

  const aim = findAimMark(cv, photo.image);
  expect(aim, 'aim mark found').not.toBeNull();
  const rect = rectifyRingTarget(cv, photo.image, aim!.ellipse, target, refine);
  const holes = detectHoles(cv, rect.image, {
    pxPerMm: rect.pxPerMm,
    caliberMm,
    black: { cx: rect.aimPx.x, cy: rect.aimPx.y, r: (target.blackDiameterMm / 2) * rect.pxPerMm },
    roi: { cx: rect.aimPx.x, cy: rect.aimPx.y, r: (scoringDiameter(target) / 2 + 5) * rect.pxPerMm },
  });
  const found = holes.map((h) => pxToMm(h, rect.aimPx, rect.pxPerMm));
  if (process.env.DEBUG_DIR) dumpDebug(`${target.id}-${seed}`, rect, holes, shots);
  return { aim: aim!, found, holes, rect };
}

/** Write the rectified image with truth (green) and detections (red) as a PPM. */
function dumpDebug(name: string, rect: { image: RGBAImage; pxPerMm: number; aimPx: Point }, holes: Point[], truth: Point[]) {
  const m = cv.matFromImageData(rect.image as ImageData);
  for (const t of truth) {
    const p = mmToPx(t, rect.aimPx, rect.pxPerMm);
    cv.circle(m, new cv.Point(p.x, p.y), 14, new cv.Scalar(0, 200, 0, 255), 2);
  }
  for (const h of holes) cv.circle(m, new cv.Point(h.x, h.y), 9, new cv.Scalar(255, 0, 0, 255), 2);
  const { cols: w, rows: h, data } = m;
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = data[i * 4];
    buf[i * 3 + 1] = data[i * 4 + 1];
    buf[i * 3 + 2] = data[i * 4 + 2];
  }
  writeFileSync(`${process.env.DEBUG_DIR}/${name}.ppm`, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), buf]));
  m.delete();
}

describe('helpers', () => {
  it('fitCircle recovers a circle', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => ({ x: 10 + 5 * Math.cos(i), y: -3 + 5 * Math.sin(i) }));
    const c = fitCircle(pts)!;
    expect(c.x).toBeCloseTo(10, 6);
    expect(c.y).toBeCloseTo(-3, 6);
    expect(c.r).toBeCloseTo(5, 6);
  });
  it('blobPeaks: one peak for a big disc, one per hole for overlapping holes', () => {
    const peaksOf = (draw: (m: InstanceType<CV['Mat']>) => void) => {
      const m = cv.Mat.zeros(200, 200, cv.CV_8UC1);
      draw(m);
      const cs = new cv.MatVector();
      const hi = new cv.Mat();
      cv.findContours(m, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
      const c = cs.get(0);
      const p = blobPeaks(cv, c, 20);
      [m, cs, hi, c].forEach((x) => x.delete());
      return p;
    };
    const white = new cv.Scalar(255);
    // A torn halo: one disc twice the hole size → a single center.
    const big = peaksOf((m) => cv.circle(m, new cv.Point(100, 100), 22, white, -1));
    expect(big).toHaveLength(1);
    expect(Math.hypot(big[0].x - 100, big[0].y - 100)).toBeLessThan(1.5);
    // Three 20 px holes overlapping slightly (18 px apart). (Heavier overlap merges into
    // one round shape — the area-based split handles that case on clean paper.)
    const three = peaksOf((m) => {
      cv.circle(m, new cv.Point(80, 100), 10, white, -1);
      cv.circle(m, new cv.Point(98, 100), 10, white, -1);
      cv.circle(m, new cv.Point(89, 116), 10, white, -1);
    });
    expect(three).toHaveLength(3);
  });
});

describe('ring target pipeline (synthetic photos)', () => {
  const pistol = getTarget('issf-pistol-precision') as RingTarget;
  const rifle = getTarget('issf-rifle-50m') as RingTarget;

  for (const seed of [1, 2, 3]) {
    it(`pistol target, 10 shots, seed ${seed}`, () => {
      const shots = randomShots(seed, 10, 160, 8);
      const { aim, found } = runRing(pistol, 3, 5.6, shots, seed);
      expect(aim.confidence).toBeGreaterThan(0.5);
      const m = matchPoints(shots, found, 1.5);
      expect(m.matched).toBe(10);
      expect(m.falsePositives).toBe(0);
    });
  }

  for (const seed of [4, 5]) {
    it(`rifle 50m target, 10 shots, seed ${seed}`, () => {
      const shots = randomShots(seed, 10, 60, 8);
      const { found } = runRing(rifle, 9, 5.6, shots, seed);
      const m = matchPoints(shots, found, 0.75);
      expect(m.matched).toBe(10);
      expect(m.falsePositives).toBe(0);
    });
  }

  for (const [t, ppm] of [[pistol, 3], [rifle, 9]] as const) {
    it(`no false positives on a clean ${t.id} target; refinement converges`, () => {
      const { found, rect } = runRing(t, ppm, 5.6, [], 21);
      expect(found).toHaveLength(0);
      expect(rect.refined).toBe(true);
      expect(rect.residualMm!).toBeLessThan(0.5);
    });
  }

  it('splits two overlapping holes', () => {
    const shots = [
      { x: 0, y: 30 },
      { x: 4, y: 30 }, // overlaps the first (5.6 mm holes, 4 mm apart)
      { x: -120, y: 10 },
    ];
    const { found, holes } = runRing(pistol, 3, 5.6, shots, 7);
    const m = matchPoints(shots, found, 3);
    expect(m.matched).toBe(3);
    expect(holes.filter((h) => h.uncertain).length).toBeGreaterThanOrEqual(2);
  });
});

describe('grid target pipeline', () => {
  it('rectifies from 4 corners and finds holes', () => {
    const pxPerMm = 4;
    const shots = randomShots(11, 6, 40, 10);
    const flat = drawGridTarget(cv, 200, 200, 10, { pxPerMm, caliberMm: 6.5, shots, seed: 11 });
    const photo = photograph(cv, flat.mat, 11);
    flat.mat.delete();
    // The user marks a 15×15 square region (150 mm) centered on the sheet.
    const c = flat.centerPx;
    const half = 75 * pxPerMm;
    const corners = [
      { x: c.x - half, y: c.y - half },
      { x: c.x + half, y: c.y - half },
      { x: c.x + half, y: c.y + half },
      { x: c.x - half, y: c.y + half },
    ].map(photo.map) as [Point, Point, Point, Point];
    const rect = rectifyByQuad(cv, photo.image, corners, 150, 150);
    const holes = detectHoles(cv, rect.image, { pxPerMm: rect.pxPerMm, caliberMm: 6.5 });
    const found = holes.map((h) => pxToMm(h, rect.aimPx, rect.pxPerMm));
    const m = matchPoints(shots, found, 1.5);
    expect(m.matched).toBe(6);
    expect(m.falsePositives).toBeLessThanOrEqual(1);
  });
});
