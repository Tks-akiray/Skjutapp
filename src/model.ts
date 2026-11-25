import type { Point } from './analysis/geometry';
import type { AngularUnit } from './analysis/units';

/** A shot in target space: mm from the aim point, y pointing down. */
export interface Shot extends Point {
  id: string;
  /** Found by auto-detection (vs. added by hand). */
  auto: boolean;
  /** Auto-detected but doubtful (overlap split / odd shape) — worth checking. */
  uncertain?: boolean;
}

/** A rectified image with scale and aim point. */
export interface Calibration {
  image: ImageData;
  pxPerMm: number;
  aimPx: Point;
  /** Ring-line refinement result (ring targets only). */
  refined?: boolean;
  residualMm?: number;
}

export interface SessionSummary {
  count: number;
  extremeSpreadMm: number;
  meanRadiusMm: number;
  offsetXMm: number;
  offsetYMm: number;
  score?: number;
  decimalScore?: number;
  xCount?: number;
}

/** A session as stored in IndexedDB. */
export interface StoredSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  targetId: string;
  distanceM: number;
  caliberMm: number;
  notes: string;
  shots: Shot[];
  pxPerMm: number;
  aimPx: Point;
  /** Rectified image (JPEG). */
  image: Blob;
  /** Small preview (JPEG). */
  thumb: Blob;
  summary: SessionSummary;
}

export interface Settings {
  clickUnit: AngularUnit;
  clickValue: number;
  sensitivity: number;
  lastTargetId: string;
  /** Per target: last used distance (m) and caliber (mm). */
  perTarget: Record<string, { distanceM: number; caliberMm: number }>;
  /** Remembered grid square size (mm). Square counts are entered per photo. */
  grid: { squareMm: number };
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** An open analysis (new, or loaded from history). */
export interface Work {
  /** Set once saved. */
  sessionId?: string;
  createdAt: number;
  targetId: string;
  distanceM: number;
  caliberMm: number;
  notes: string;
  calib: Calibration;
  shots: Shot[];
}
