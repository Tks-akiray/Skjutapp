/** 2D point. In target space units are mm, origin = aim point, x → right, y → down. */
export interface Point {
  x: number;
  y: number;
}

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });

/** Convert a target-space point (mm from aim) to pixel coordinates in the rectified image. */
export const mmToPx = (p: Point, aimPx: Point, pxPerMm: number): Point => ({
  x: aimPx.x + p.x * pxPerMm,
  y: aimPx.y + p.y * pxPerMm,
});

/** Convert a pixel coordinate in the rectified image to target space (mm from aim). */
export const pxToMm = (p: Point, aimPx: Point, pxPerMm: number): Point => ({
  x: (p.x - aimPx.x) / pxPerMm,
  y: (p.y - aimPx.y) / pxPerMm,
});
