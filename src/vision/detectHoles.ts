import type { CV, RGBAImage } from './cv';
import type { Point } from '../analysis/geometry';

export interface DetectOptions {
  pxPerMm: number;
  caliberMm: number;
  /** Black aiming mark in rectified pixels (ring targets). Holes there are light, not dark. */
  black?: { cx: number; cy: number; r: number };
  /** Only search inside this circle (rectified pixels). */
  roi?: { cx: number; cy: number; r: number };
  /** 0..1, higher finds fainter holes (and more false positives). Default 0.5. */
  sensitivity?: number;
  /** Development hook: receives intermediate single-channel images. */
  debug?: (name: string, img: RGBAImage) => void;
}

export interface DetectedHole extends Point {
  /** 0..1 */
  confidence: number;
  /** True if the hole was split from an overlapping blob or has an irregular shape. */
  uncertain: boolean;
}

const odd = (n: number) => (Math.round(n) | 1);

/** Hole diameter (px) the detector works at; larger images are downscaled first. */
const WORK_HOLE_PX = 14;
/** Minimum share of the raw (un-opened) response that must survive the opening. */
const MIN_RETAINED = 0.7;

/**
 * Detect bullet holes in a rectified target image.
 *
 * Holes are dark on white paper and light on the black aiming mark. We work at a scale
 * where a hole is ~14 px wide, compute a black-hat (dark spots) and a top-hat (light
 * spots) response with a kernel larger than a hole, and open that response with a disc
 * about half a hole wide so thin structures (ring lines, printed numbers) disappear
 * before thresholding. Remaining blobs must be filled discs of roughly bullet size;
 * blobs the size of several holes are split with k-means.
 */
export function detectHoles(cv: CV, img: RGBAImage, opts: DetectOptions): DetectedHole[] {
  const sensitivity = opts.sensitivity ?? 0.5;
  const f = Math.min(1, WORK_HOLE_PX / (opts.caliberMm * opts.pxPerMm));
  const holeD = opts.caliberMm * opts.pxPerMm * f;
  const expectedArea = Math.PI * (holeD / 2) ** 2;
  const W = Math.max(1, Math.round(img.width * f));
  const H = Math.max(1, Math.round(img.height * f));
  // Pixel-center aware mapping between the original and the working image.
  const sx = W / img.width;
  const sy = H / img.height;
  const toWork = (p: Point) => ({ x: (p.x + 0.5) * sx - 0.5, y: (p.y + 0.5) * sy - 0.5 });
  const toOrig = (p: Point) => ({ x: (p.x + 0.5) / sx - 0.5, y: (p.y + 0.5) / sy - 0.5 });

  const src = cv.matFromImageData(img as ImageData);
  const gray = new cv.Mat();
  const blackhat = new cv.Mat();
  const tophat = new cv.Mat();
  const whiteZone = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const blackZone = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const mask = new cv.Mat();
  const rawMask = new cv.Mat();
  const rawResponse = new cv.Mat();
  const response = new cv.Mat();
  const tmp = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const disc = (d: number) => cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(odd(d), odd(d)));
  // Background window: large enough that a cluster of overlapping holes isn't hollowed out.
  const big = disc(holeD * 4.5);
  const openK = disc(Math.max(3, holeD * 0.55));
  const closeK = disc(3);
  const seamK = disc(5);

  try {
    // Darkness = brightest color channel (HSV value). Holes are dark in every channel,
    // while colored print (red/orange/green sight-in targets) stays bright in at least one,
    // so it doesn't look like a hole. Black ink is dark either way.
    const ch = new cv.MatVector();
    cv.split(src, ch);
    const r = ch.get(0), g = ch.get(1), b = ch.get(2), a = ch.get(3);
    cv.max(r, g, gray);
    cv.max(gray, b, gray);
    [r, g, b, a].forEach((m) => m.delete());
    ch.delete();
    if (f < 1) cv.resize(gray, gray, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    cv.morphologyEx(gray, blackhat, cv.MORPH_BLACKHAT, big);
    cv.morphologyEx(gray, tophat, cv.MORPH_TOPHAT, big);

    // Zones: dark holes on light paper, light holes on dark print. The split is exact so a
    // hole straddling the edge of a dark area forms one connected blob.
    const white = new cv.Scalar(255);
    const roiMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    if (opts.roi) {
      const c = toWork({ x: opts.roi.cx, y: opts.roi.cy });
      cv.circle(roiMask, new cv.Point(Math.round(c.x), Math.round(c.y)), Math.round(opts.roi.r * sx), white, -1);
    } else {
      roiMask.setTo(white);
    }
    if (opts.black) {
      // Known aiming mark (ring targets).
      const c = toWork({ x: opts.black.cx, y: opts.black.cy });
      cv.circle(blackZone, new cv.Point(Math.round(c.x), Math.round(c.y)), Math.round(opts.black.r * sx), white, -1);
    } else {
      findDarkAreas(cv, gray, holeD, blackZone);
    }
    cv.bitwise_not(blackZone, whiteZone);
    cv.bitwise_and(whiteZone, roiMask, whiteZone);
    cv.bitwise_and(blackZone, roiMask, blackZone);
    roiMask.delete();

    // Combined response (zones are disjoint 0/255 masks, so min() masks and max() merges).
    // In dark areas a hole is light torn paper around a center that is often darker than
    // the ink (dark backing), so both directions count there.
    if (cv.countNonZero(blackZone) > 0) {
      // White print inside dark areas (ring lines, numbers) is as bright as clean paper,
      // while torn paper in a hole is clearly grayer. Ignore paper-bright pixels there so
      // print can't merge with holes.
      const paper = percentile(gray, 0.9);
      const print = new cv.Mat();
      cv.threshold(gray, print, paper * 0.85, 255, cv.THRESH_BINARY);
      const k3 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
      cv.dilate(print, print, k3);
      k3.delete();
      cv.bitwise_and(print, blackZone, print);
      tophat.setTo(new cv.Scalar(0), print);
      print.delete();
    }
    cv.min(blackhat, whiteZone, blackhat);
    cv.min(tophat, blackZone, tophat);
    cv.max(blackhat, tophat, rawResponse);
    if (cv.countNonZero(blackZone) > 0) {
      // Blurred pixels along the edge of a dark area respond weakly in both zones, which
      // splits a hole straddling the edge. Bridge that seam within a narrow band only.
      const band = new cv.Mat();
      const k3 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
      cv.morphologyEx(blackZone, band, cv.MORPH_GRADIENT, k3);
      k3.delete();
      cv.morphologyEx(rawResponse, tmp, cv.MORPH_CLOSE, seamK);
      tmp.copyTo(rawResponse, band);
      band.delete();
    }
    // Thin features (lines, text strokes) vanish; filled holes survive.
    cv.morphologyEx(rawResponse, response, cv.MORPH_OPEN, openK);

    if (opts.debug) {
      for (const [name, m] of [['response', response], ['rawResponse', rawResponse], ['darkZone', blackZone]] as const) {
        const rgba = new cv.Mat();
        cv.cvtColor(m, rgba, cv.COLOR_GRAY2RGBA);
        opts.debug(name, { data: new Uint8ClampedArray(rgba.data), width: rgba.cols, height: rgba.rows });
        rgba.delete();
      }
    }

    const thrWhite = zoneThreshold(cv, response, whiteZone, sensitivity);
    const hasDark = cv.countNonZero(blackZone) > 0;
    const thrBlack = hasDark ? zoneThreshold(cv, response, blackZone, sensitivity) : 255;
    const binarize = (resp: InstanceType<CV['Mat']>, out: InstanceType<CV['Mat']>) => {
      cv.threshold(resp, out, thrWhite, 255, cv.THRESH_BINARY);
      cv.bitwise_and(out, whiteZone, out);
      if (hasDark) {
        cv.threshold(resp, tmp, thrBlack, 255, cv.THRESH_BINARY);
        cv.bitwise_and(tmp, blackZone, tmp);
        cv.bitwise_or(out, tmp, out);
      }
    };
    // Raw mask (before opening): holes are filled discs here, glyphs are thin strokes.
    binarize(rawResponse, rawMask);
    binarize(response, mask);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closeK);

    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    const holes: DetectedHole[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        const ratio = area / expectedArea;
        // Upper limit is generous: torn paper around holes in black makes each hole look
        // 2–3× bigger, and a tight group merges into one blob.
        if (ratio < 0.5 || ratio > 60) continue;
        // Shapes cut by the image edge are unreliable (usually print running off the photo).
        const bb = cv.boundingRect(c);
        if (bb.x <= 0 || bb.y <= 0 || bb.x + bb.width >= W || bb.y + bb.height >= H) continue;

        const perimeter = cv.arcLength(c, true);
        const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
        const hull = new cv.Mat();
        cv.convexHull(c, hull, false, true);
        const solidity = area / Math.max(1, cv.contourArea(hull));
        hull.delete();

        const m = cv.moments(c);
        const center = { x: m.m10 / m.m00, y: m.m01 / m.m00 };
        // Elongation from second moments: two overlapping holes are clearly elongated.
        const mu20 = m.mu20 / m.m00;
        const mu02 = m.mu02 / m.m00;
        const mu11 = m.mu11 / m.m00;
        const tr = (mu20 + mu02) / 2;
        const spread = Math.sqrt(((mu20 - mu02) / 2) ** 2 + mu11 ** 2);
        const elongation = Math.sqrt((tr + spread) / Math.max(1e-9, tr - spread));

        if (ratio < 3) {
          // Small blobs: reject printed glyph remnants. Their raw strokes extend well beyond
          // the blob left after opening; for a hole the raw and opened masks nearly agree.
          if (solidity < 0.6) continue;
          const win = Math.sqrt(area / Math.PI) + holeD * 0.3;
          const retained = countInDisc(mask, center, win) / Math.max(1, countInDisc(rawMask, center, win));
          if (retained < MIN_RETAINED) continue;
        }

        const single = ratio < 1.2 || (ratio < 1.6 && elongation < 1.35);
        if (single) {
          if (circularity < 0.65) continue;
          const sizeScore = 1 - Math.min(1, Math.abs(Math.log(ratio)) / Math.log(3));
          const confidence = Math.max(0, Math.min(1, circularity * 0.4 + solidity * 0.3 + sizeScore * 0.3));
          holes.push({
            ...toOrig(center),
            confidence,
            uncertain: circularity < 0.7 || solidity < 0.9,
          });
          continue;
        }

        // Bigger blobs: overlapping holes, a tight group, or one hole with a torn halo.
        // A blob about two holes big must be quite convex (printed digits can mimic a pair).
        if (ratio < 2.5 && solidity < 0.89) continue;
        const peaks = blobPeaks(cv, c, holeD);
        const inDark = blackZone.data[Math.round(center.y) * W + Math.round(center.x)] > 0;
        let centers: Point[];
        if (inDark) {
          // Torn paper around holes in black inflates the area, so count round parts.
          centers = peaks;
        } else {
          // Clean holes in paper: the area is a good count, and heavily overlapping holes
          // merge into one round shape with a single peak, so take the larger estimate.
          const k = Math.min(8, Math.max(2, peaks.length, Math.round(ratio)));
          centers = splitBlob(cv, c, k);
        }
        for (const p of centers) {
          holes.push({ ...toOrig(p), confidence: 0.4, uncertain: true });
        }
      } finally {
        c.delete();
      }
    }
    return holes;
  } finally {
    [src, gray, blackhat, tophat, rawResponse, response, whiteZone, blackZone, mask, rawMask, tmp, contours, hierarchy, big, openK, closeK, seamK].forEach(
      (m) => m.delete(),
    );
  }
}

/**
 * Find large dark printed areas (aiming blacks) without knowing the target: regions much
 * darker than the paper and wider than a few holes. Holes, text and lines are too small to
 * count, so they stay in the light zone where they are found as dark spots.
 */
function findDarkAreas(cv: CV, v: InstanceType<CV['Mat']>, holeD: number, out: InstanceType<CV['Mat']>) {
  const paper = percentile(v, 0.9);
  const blurred = new cv.Mat();
  const k = odd(holeD) | 1;
  cv.GaussianBlur(v, blurred, new cv.Size(k, k), 0);
  cv.threshold(blurred, out, paper * 0.5, 255, cv.THRESH_BINARY_INV);
  blurred.delete();
  // 1) Fill light ring lines, numbers and holes inside dark areas (they would otherwise cut
  //    the black into thin annuli). 2) Keep only regions that can contain a disc ~3 holes
  //    wide, which drops text, lines and holes in the light paper.
  const fill = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(odd(holeD * 2), odd(holeD * 2)));
  const kern = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(odd(holeD * 3), odd(holeD * 3)));
  cv.morphologyEx(out, out, cv.MORPH_CLOSE, fill);
  cv.morphologyEx(out, out, cv.MORPH_OPEN, kern);
  fill.delete();
  kern.delete();
}

/** Value below which a fraction q of an 8-bit image's pixels lie. */
function percentile(img: InstanceType<CV['Mat']>, q: number): number {
  const hist = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i++) hist[d[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= q * d.length) return v;
  }
  return 255;
}

/** Number of set pixels of a binary mask inside a disc. */
function countInDisc(mask: InstanceType<CV['Mat']>, c: Point, r: number): number {
  const d = mask.data;
  const w = mask.cols;
  const h = mask.rows;
  let set = 0;
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(c.y - r)); y <= Math.min(h - 1, Math.ceil(c.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(c.x - r)); x <= Math.min(w - 1, Math.ceil(c.x + r)); x++) {
      if ((x - c.x) ** 2 + (y - c.y) ** 2 <= r2 && d[y * w + x]) set++;
    }
  }
  return set;
}

/**
 * Threshold for a response image inside a zone, from robust statistics (median + MAD) so
 * a few strong structures (holes, line residue) don't inflate it, with an absolute floor.
 */
function zoneThreshold(
  cv: CV,
  response: InstanceType<CV['Mat']>,
  zone: InstanceType<CV['Mat']>,
  sensitivity: number,
): number {
  if (cv.countNonZero(zone) === 0) return 255;
  const hist = new Uint32Array(256);
  const r = response.data;
  const z = zone.data;
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    if (z[i]) {
      hist[r[i]]++;
      n++;
    }
  }
  const percentile = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= q * n) return v;
    }
    return 255;
  };
  const median = percentile(0.5);
  // MAD from the histogram of |v - median|.
  const dev = new Uint32Array(256);
  for (let v = 0; v < 256; v++) dev[Math.abs(v - median)] += hist[v];
  let acc = 0;
  let mad = 0;
  for (let d = 0; d < 256; d++) {
    acc += dev[d];
    if (acc >= 0.5 * n) {
      mad = d;
      break;
    }
  }
  const sigma = Math.max(1, 1.4826 * mad);
  const k = 10 - 6 * sensitivity; // 0 → 10σ, 1 → 4σ
  const floor = 45 - 30 * sensitivity; // 0 → 45, 1 → 15 grey levels
  return Math.max(floor, median + k * sigma);
}

/**
 * Hole centers inside a blob of overlapping holes: peaks of the distance transform (the
 * centers of the round parts), with greedy non-maximum suppression. Thin parts merged into
 * the blob (ring lines, text) are too narrow to produce peaks.
 */
export function blobPeaks(cv: CV, contour: InstanceType<CV['Mat']>, holeD: number): Point[] {
  const r = cv.boundingRect(contour);
  const pad = 2;
  const w = r.width + 2 * pad;
  const h = r.height + 2 * pad;
  const blob = cv.Mat.zeros(h, w, cv.CV_8UC1);
  const vec = new cv.MatVector();
  const dist = new cv.Mat();
  try {
    const pts = contour.data32S;
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i += 2) arr.push(pts[i] - r.x + pad, pts[i + 1] - r.y + pad);
    const local = cv.matFromArray(pts.length / 2, 1, cv.CV_32SC2, arr);
    vec.push_back(local);
    local.delete();
    cv.drawContours(blob, vec, 0, new cv.Scalar(255), -1);
    cv.distanceTransform(blob, dist, cv.DIST_L2, 5);

    const minR = 0.36 * holeD;
    const d = dist.data32F;
    const cand: { x: number; y: number; v: number }[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const v = d[y * w + x];
        if (v < minR) continue;
        // Local maximum in the 3×3 neighborhood.
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++)
          for (let dx = -1; dx <= 1; dx++) if (d[(y + dy) * w + x + dx] > v) { isMax = false; break; }
        if (isMax) cand.push({ x, y, v });
      }
    }
    cand.sort((a, b) => b.v - a.v);
    const peaks: { x: number; y: number; v: number }[] = [];
    for (const c of cand) {
      if (peaks.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= Math.max(0.55 * holeD, 0.9 * p.v))) peaks.push(c);
    }
    return peaks.map((p) => ({ x: p.x + r.x - pad, y: p.y + r.y - pad }));
  } finally {
    blob.delete();
    vec.delete();
    dist.delete();
  }
}

/** Split a blob of k overlapping holes into k centers with k-means on its pixels. */
function splitBlob(cv: CV, contour: InstanceType<CV['Mat']>, k: number): Point[] {
  const r = cv.boundingRect(contour);
  const blob = cv.Mat.zeros(r.height, r.width, cv.CV_8UC1);
  const vec = new cv.MatVector();
  try {
    // Shift the contour into the bounding box and rasterize it.
    const pts = contour.data32S;
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i += 2) arr.push(pts[i] - r.x, pts[i + 1] - r.y);
    const local = cv.matFromArray(pts.length / 2, 1, cv.CV_32SC2, arr);
    vec.push_back(local);
    local.delete();
    cv.drawContours(blob, vec, 0, new cv.Scalar(255), -1);

    const px: Point[] = [];
    const d = blob.data;
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) if (d[y * r.width + x]) px.push({ x: x + r.x, y: y + r.y });
    }
    return kmeans(px, k);
  } finally {
    blob.delete();
    vec.delete();
  }
}

/** Deterministic k-means with farthest-point initialization. */
export function kmeans(points: Point[], k: number, iterations = 20): Point[] {
  if (points.length === 0) return [];
  const mean = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  const centers: Point[] = [{ x: mean.x / points.length, y: mean.y / points.length }];
  // Farthest-point seeding (first center replaced by the point farthest from the mean).
  const far = (from: Point[]) => {
    let best = points[0];
    let bestD = -1;
    for (const p of points) {
      const d = Math.min(...from.map((c) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  centers[0] = far(centers);
  while (centers.length < k) centers.push(far(centers));

  const assign = new Int32Array(points.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (points[i].x - centers[j].x) ** 2 + (points[i].y - centers[j].y) ** 2;
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      assign[i] = bi;
    }
    const sums = centers.map(() => ({ x: 0, y: 0, n: 0 }));
    points.forEach((p, i) => {
      const s = sums[assign[i]];
      s.x += p.x;
      s.y += p.y;
      s.n += 1;
    });
    sums.forEach((s, j) => {
      if (s.n) centers[j] = { x: s.x / s.n, y: s.y / s.n };
    });
  }
  return centers;
}
