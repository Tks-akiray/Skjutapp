import type { Point } from '../analysis/geometry';
import type { RGBAImage } from './cv';
import type { DetectOptions, DetectedHole } from './detectHoles';
import type { AimMarkResult, Ellipse, Rectified, RectifiedRing } from './rectify';

/** Messages the vision worker understands, with their results. */
export interface VisionApi {
  findAim: { args: { image: RGBAImage }; result: AimMarkResult | null };
  fitEdge: { args: { points: Point[] }; result: Ellipse | null };
  rectifyRing: { args: { image: RGBAImage; ellipse: Ellipse; targetId: string }; result: RectifiedRing };
  rectifyQuad: {
    args: { image: RGBAImage; corners: [Point, Point, Point, Point]; widthMm: number; heightMm: number };
    result: Rectified;
  };
  detect: { args: { image: RGBAImage; opts: Omit<DetectOptions, 'debug'> }; result: DetectedHole[] };
}

export type VisionMethod = keyof VisionApi;

export interface VisionRequest<M extends VisionMethod = VisionMethod> {
  id: number;
  method: M;
  args: VisionApi[M]['args'];
}

export type VisionResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: -1; ok: true; result: 'ready' };
