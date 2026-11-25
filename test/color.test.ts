import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadCvNode } from './cvNode';
import { loadPhoto } from './realPhoto';
import { matchPoints, rng } from './synthetic';
import { detectHoles } from '../src/vision/detectHoles';
import type { CV, RGBAImage } from '../src/vision/cv';
import type { Point } from '../src/analysis/geometry';

let cv: CV;
beforeAll(async () => {
  cv = await loadCvNode();
});

/** A sight-in style target: white paper, red grid, thick red bands and diamonds, dark holes. */
function colorTarget(ppm: number, shots: Point[], caliberMm: number): RGBAImage {
  const S = Math.round(250 * ppm);
  const m = new cv.Mat(S, S, cv.CV_8UC4, new cv.Scalar(238, 240, 236, 255));
  const red = new cv.Scalar(235, 95, 80, 255);
  const P = (x: number, y: number) => new cv.Point(Math.round(x * ppm), Math.round(y * ppm));
  for (let v = 0; v <= 250; v += 25.4) {
    cv.line(m, P(v, 0), P(v, 250), red, Math.max(1, Math.round(0.5 * ppm)));
    cv.line(m, P(0, v), P(250, v), red, Math.max(1, Math.round(0.5 * ppm)));
  }
  // Thick diagonal bands and a diamond outline, like the corners/center of a sight-in target.
  cv.line(m, P(0, 40), P(40, 0), red, Math.round(10 * ppm));
  cv.line(m, P(210, 250), P(250, 210), red, Math.round(10 * ppm));
  const d = [P(125, 70), P(180, 125), P(125, 180), P(70, 125)];
  for (let i = 0; i < 4; i++) cv.line(m, d[i], d[(i + 1) % 4], red, Math.round(8 * ppm));
  cv.rectangle(m, P(115, 0), P(135, 40), red, -1);
  const rand = rng(3);
  for (const s of shots) {
    const r = (caliberMm / 2) * ppm * 0.95;
    const c = P(125 + s.x, 125 + s.y);
    const shade = 45 + Math.round(rand() * 25);
    cv.circle(m, c, Math.round(r), new cv.Scalar(shade + 15, shade, shade - 5, 255), -1);
  }
  cv.GaussianBlur(m, m, new cv.Size(3, 3), 0);
  const img = { data: new Uint8ClampedArray(m.data), width: S, height: S };
  m.delete();
  return img;
}

describe('colored targets', () => {
  it('ignores red print and finds dark holes (incl. a 3-hole cluster)', () => {
    const ppm = 4;
    const cal = 7.62;
    const shots = [
      { x: -40, y: -30 },
      { x: 30, y: 45 },
      { x: 60, y: -55 },
      { x: 52.0, y: 10 }, // on the diamond band
      // Cloverleaf of three overlapping holes.
      { x: -10, y: 20 },
      { x: -4, y: 20 },
      { x: -7, y: 25 },
    ].map((p) => ({ ...p }));
    const img = colorTarget(ppm, shots, cal);
    const holes = detectHoles(cv, img, { pxPerMm: ppm, caliberMm: cal });
    const found = holes.map((h) => ({ x: h.x / ppm - 125, y: h.y / ppm - 125 }));
    const m = matchPoints(shots, found, 3);
    expect(m.falsePositives).toBe(0);
    expect(m.matched).toBeGreaterThanOrEqual(6);
  });
});

// Optional check on a real photo, if present locally (not part of the repo).
const REAL = 'Pictures/5-shot-Group-002-1005x1024.jpg';
describe.skipIf(!existsSync(REAL))('real photo: red sight-in target, 5-shot cluster', () => {
  it('finds the cluster and nothing else', () => {
    const img = loadPhoto(REAL);
    if (!img) return;
    const holes = detectHoles(cv, img, { pxPerMm: 100 / 25.4, caliberMm: 7.82 });
    expect(holes.length).toBeGreaterThanOrEqual(3);
    for (const h of holes) {
      expect(h.x).toBeGreaterThan(450);
      expect(h.x).toBeLessThan(540);
      expect(h.y).toBeGreaterThan(420);
      expect(h.y).toBeLessThan(510);
    }
  });
});
