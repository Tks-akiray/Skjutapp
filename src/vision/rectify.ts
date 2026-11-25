import type { CV, RGBAImage } from './cv';
import type { Point } from '../analysis/geometry';
import { scoringDiameter, type RingTarget } from '../targets/definitions';
import { mul3, refineFromRings } from './ringRefine';

/** Ellipse in image pixels. w/h are full axis lengths, angle (deg) is the w axis direction. */
export interface Ellipse {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export interface AimMarkResult {
  ellipse: Ellipse;
  /** 0..1, how well the blob matches a filled ellipse. */
  confidence: number;
}

/** A straightened image with a known scale and aim point. */
export interface Rectified {
  image: RGBAImage;
  pxPerMm: number;
  aimPx: Point;
}

/** Largest output side (px) of a rectified image. */
export const MAX_OUTPUT_PX = 2000;

const toRGBA = (mat: InstanceType<CV['Mat']>): RGBAImage => ({
  data: new Uint8ClampedArray(mat.data),
  width: mat.cols,
  height: mat.rows,
});

/**
 * Find the black aiming mark of a ring target: the largest dark, filled, roughly
 * elliptical blob in the photo.
 */
export function findAimMark(cv: CV, img: RGBAImage): AimMarkResult | null {
  const src = cv.matFromImageData(img as ImageData);
  const gray = new cv.Mat();
  const bin = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    // 1) Opening removes thin dark ink (ring lines, numbers) so it cannot bridge onto the
    //    black mark. 2) Closing fills the thin white ring lines inside the black mark.
    const k = Math.max(3, Math.round(Math.min(img.width, img.height) * 0.01)) | 1;
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);
    kernel.delete();

    // RETR_CCOMP: a dark table around the paper forms a frame whose *hole* contains the
    // aim mark, so the mark is not an external contour. Components (parent = -1) are
    // outer boundaries at any nesting depth; their holes are the second level.
    cv.findContours(bin, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    const hier = hierarchy.data32S;

    const imgArea = img.width * img.height;
    const border = 2;
    let best: { score: number; result: AimMarkResult } | null = null;

    for (let i = 0; i < contours.size(); i++) {
      if (hier[i * 4 + 3] !== -1) continue; // a hole, not a component
      const c = contours.get(i);
      // Ink area = outer area minus holes. A thin ring line encloses a big area but has
      // almost no ink, so it must not look like a filled disc.
      let area = cv.contourArea(c);
      for (let ch = hier[i * 4 + 2]; ch !== -1; ch = hier[ch * 4]) {
        const hole = contours.get(ch);
        area -= cv.contourArea(hole);
        hole.delete();
      }
      if (area < imgArea * 0.003) {
        c.delete();
        continue;
      }
      const rect = cv.boundingRect(c);
      const touchesBorder =
        rect.x <= border ||
        rect.y <= border ||
        rect.x + rect.width >= img.width - border ||
        rect.y + rect.height >= img.height - border;

      const hull = new cv.Mat();
      cv.convexHull(c, hull, false, true);
      if (hull.rows < 5) {
        hull.delete();
        c.delete();
        continue;
      }
      const rr = cv.fitEllipse(hull);
      const hullArea = cv.contourArea(hull);
      hull.delete();
      c.delete();

      const ellipseArea = (Math.PI * rr.size.width * rr.size.height) / 4;
      if (ellipseArea <= 0) continue;
      const fill = Math.min(area, hullArea) / ellipseArea; // ~1 for a filled ellipse
      const fit = hullArea / ellipseArea; // ~1 if the outline is elliptical
      const aspect = Math.min(rr.size.width, rr.size.height) / Math.max(rr.size.width, rr.size.height);
      if (aspect < 0.45 || fit < 0.85 || fit > 1.15) continue;

      const fillScore = Math.max(0, Math.min(1, (fill - 0.75) / 0.2));
      const fitScore = Math.max(0, 1 - Math.abs(1 - fit) / 0.15);
      let confidence = fillScore * fitScore * Math.min(1, aspect / 0.7);
      if (touchesBorder) confidence *= 0.3;

      const score = confidence * Math.sqrt(area);
      if (!best || score > best.score) {
        best = {
          score,
          result: {
            ellipse: {
              cx: rr.center.x,
              cy: rr.center.y,
              w: rr.size.width,
              h: rr.size.height,
              angle: rr.angle,
            },
            confidence,
          },
        };
      }
    }
    return best?.result ?? null;
  } finally {
    src.delete();
    gray.delete();
    bin.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Fit an ellipse through ≥5 user-marked edge points, or a circle through 3–4 points. */
export function fitEllipseToPoints(cv: CV, pts: Point[]): Ellipse | null {
  if (pts.length >= 5) {
    const mat = cv.matFromArray(pts.length, 1, cv.CV_32FC2, pts.flatMap((p) => [p.x, p.y]));
    try {
      const rr = cv.fitEllipse(mat);
      return { cx: rr.center.x, cy: rr.center.y, w: rr.size.width, h: rr.size.height, angle: rr.angle };
    } finally {
      mat.delete();
    }
  }
  const c = fitCircle(pts);
  return c ? { cx: c.x, cy: c.y, w: 2 * c.r, h: 2 * c.r, angle: 0 } : null;
}

/** Least-squares circle fit (Kåsa method). */
export function fitCircle(pts: Point[]): { x: number; y: number; r: number } | null {
  if (pts.length < 3) return null;
  // Solve [x y 1]·[D E F]ᵀ = -(x²+y²) in the least-squares sense via normal equations.
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0;
  let sxz = 0, syz = 0, sz = 0;
  for (const p of pts) {
    const z = -(p.x * p.x + p.y * p.y);
    sxx += p.x * p.x; sxy += p.x * p.y; sx += p.x;
    syy += p.y * p.y; sy += p.y; n += 1;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const b = [sxz, syz, sz];
  const sol = solve3(A, b);
  if (!sol) return null;
  const [D, E, F] = sol;
  const x = -D / 2;
  const y = -E / 2;
  const r2 = x * x + y * y - F;
  if (r2 <= 0) return null;
  return { x, y, r: Math.sqrt(r2) };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((col) => det(A.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)))) / d);
}

/** Rectified ring target, plus how the ring-line refinement went. */
export interface RectifiedRing extends Rectified {
  /** True if the perspective was refined from the ring lines. */
  refined: boolean;
  /** RMS distance (mm) between detected ring-line points and the fitted model. */
  residualMm?: number;
  /** Number of ring-line points the refinement used. */
  ringPoints?: number;
}

type Mat3 = number[]; // row-major 3×3

/**
 * Rectify a ring target photo.
 *
 * 1. Affine warp that turns the black aiming mark (an ellipse in the photo) into a circle
 *    of its true size — exact for a camera facing the target squarely.
 * 2. Refinement: locate the ring lines and the black edge along rays from the center and
 *    fit a full homography to their known radii. This removes remaining perspective
 *    distortion from a tilted camera.
 */
export function rectifyRingTarget(cv: CV, img: RGBAImage, e: Ellipse, target: RingTarget, refine = true): RectifiedRing {
  const outputDiameterMm = scoringDiameter(target) * 1.1;
  const a = e.w / 2;
  const b = e.h / 2;
  const sourcePxPerMm = (a + b) / target.blackDiameterMm;
  const pxPerMm = Math.min(sourcePxPerMm, MAX_OUTPUT_PX / outputDiameterMm);
  const size = Math.round(outputDiameterMm * pxPerMm);
  const R = (target.blackDiameterMm / 2) * pxPerMm;
  const c = size / 2;

  // A = T(c) · Rot(θ) · diag(R/a, R/b) · Rot(-θ) · T(-center)
  const t = (e.angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const sa = R / a;
  const sb = R / b;
  const m00 = sa * cos * cos + sb * sin * sin;
  const m01 = (sa - sb) * cos * sin;
  const m11 = sa * sin * sin + sb * cos * cos;
  const A: Mat3 = [m00, m01, c - (m00 * e.cx + m01 * e.cy), m01, m11, c - (m01 * e.cx + m11 * e.cy), 0, 0, 1];

  const src = cv.matFromImageData(img as ImageData);
  const warp = (M: Mat3) => {
    const Mm = cv.matFromArray(3, 3, cv.CV_64F, M);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, Mm, new cv.Size(size, size), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(128, 128, 128, 255));
    Mm.delete();
    return dst;
  };

  try {
    let M = A;
    let dst = warp(M);
    const result: RectifiedRing = { image: toRGBA(dst), pxPerMm, aimPx: { x: c, y: c }, refined: false };
    if (!refine) {
      dst.delete();
      return result;
    }

    const gray = new cv.Mat();
    cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);
    dst.delete();
    const fit = refineFromRings(cv, { data: gray.data, width: size, height: size }, pxPerMm, { x: c, y: c }, target);
    gray.delete();
    if (!fit) return result;

    // Final mapping: photo → affine-rectified px → mm → output px.
    const S: Mat3 = [pxPerMm, 0, c, 0, pxPerMm, c, 0, 0, 1];
    M = mul3(S, mul3(fit.H, A));
    dst = warp(M);
    const refined: RectifiedRing = {
      image: toRGBA(dst),
      pxPerMm,
      aimPx: { x: c, y: c },
      refined: true,
      residualMm: fit.rmsMm,
      ringPoints: fit.points,
    };
    dst.delete();
    return refined;
  } finally {
    src.delete();
  }
}

/**
 * Perspective-correct a photo from 4 marked corners (TL, TR, BR, BL) of a rectangle
 * with known size in mm, e.g. N×M squares on grid paper. The whole photo is kept.
 */
export function rectifyByQuad(
  cv: CV,
  img: RGBAImage,
  corners: [Point, Point, Point, Point],
  widthMm: number,
  heightMm: number,
): Rectified {
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y]));
  const mmPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, widthMm, 0, widthMm, heightMm, 0, heightMm]);
  const Hmm = cv.getPerspectiveTransform(srcPts, mmPts);

  // Where do the photo corners land (in mm)?
  const imgCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, img.width, 0, img.width, img.height, 0, img.height]);
  const mapped = new cv.Mat();
  cv.perspectiveTransform(imgCorners, mapped, Hmm);
  const md = mapped.data32F;
  // Limit the output to 3× the marked rectangle in every direction (strong perspective
  // can otherwise send the far corners towards infinity).
  const lim = 3 * Math.max(widthMm, heightMm);
  const clampX = (v: number) => Math.max(-lim, Math.min(widthMm + lim, v));
  const clampY = (v: number) => Math.max(-lim, Math.min(heightMm + lim, v));
  const xs = [0, 2, 4, 6].map((i) => clampX(md[i]));
  const ys = [1, 3, 5, 7].map((i) => clampY(md[i]));
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, widthMm);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, heightMm);

  const sidePx =
    (Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) +
      Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y)) /
    2;
  const sourcePxPerMm = sidePx / widthMm;
  const pxPerMm = Math.min(sourcePxPerMm, MAX_OUTPUT_PX / Math.max(maxX - minX, maxY - minY));
  const outW = Math.round((maxX - minX) * pxPerMm);
  const outH = Math.round((maxY - minY) * pxPerMm);

  const toPx = (x: number, y: number) => [(x - minX) * pxPerMm, (y - minY) * pxPerMm];
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ...toPx(0, 0),
    ...toPx(widthMm, 0),
    ...toPx(widthMm, heightMm),
    ...toPx(0, heightMm),
  ]);
  const H = cv.getPerspectiveTransform(srcPts, dstPts);
  const src = cv.matFromImageData(img as ImageData);
  const dst = new cv.Mat();
  try {
    cv.warpPerspective(src, dst, H, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(128, 128, 128, 255));
    const [ax, ay] = toPx(widthMm / 2, heightMm / 2);
    return { image: toRGBA(dst), pxPerMm, aimPx: { x: ax, y: ay } };
  } finally {
    [srcPts, mmPts, Hmm, imgCorners, mapped, dstPts, H, src, dst].forEach((m) => m.delete());
  }
}

/** Scale-only calibration from two points a known distance apart. No warping. */
export function rectifyByScale(img: RGBAImage, p1: Point, p2: Point, distanceMm: number): Rectified {
  const pxPerMm = Math.hypot(p2.x - p1.x, p2.y - p1.y) / distanceMm;
  return { image: img, pxPerMm, aimPx: { x: img.width / 2, y: img.height / 2 } };
}
