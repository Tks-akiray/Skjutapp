export type TargetKind = 'ring' | 'grid' | 'manual';

interface BaseTarget {
  id: string;
  name: string;
  kind: TargetKind;
  defaultDistanceM: number;
  defaultCaliberMm: number;
}

export interface RingTarget extends BaseTarget {
  kind: 'ring';
  /** Outer diameter of the 10 ring (mm). */
  tenDiameterMm: number;
  /** Diameter increase per ring (mm), i.e. 2 × ring width. */
  ringStepMm: number;
  /** Diameter of the inner ten / X ring (mm). */
  innerTenDiameterMm: number;
  /** Diameter of the black aiming mark (mm). */
  blackDiameterMm: number;
  /** Lowest scoring ring (usually 1). */
  lowestRing: number;
}

export interface GridTarget extends BaseTarget {
  kind: 'grid';
}

export interface ManualTarget extends BaseTarget {
  kind: 'manual';
}

export type TargetDef = RingTarget | GridTarget | ManualTarget;

/** Outer diameter (mm) of a given scoring ring. */
export const ringDiameter = (t: RingTarget, ring: number): number =>
  t.tenDiameterMm + (10 - ring) * t.ringStepMm;

/** Outer diameter of the whole scoring area (lowest ring). */
export const scoringDiameter = (t: RingTarget): number => ringDiameter(t, t.lowestRing);

// Dimensions per ISSF General Technical Rules, 6.3.4 (target dimensions).
export const TARGETS: TargetDef[] = [
  {
    id: 'issf-pistol-precision',
    name: 'ISSF 25m / 50m precision pistol',
    kind: 'ring',
    tenDiameterMm: 50,
    ringStepMm: 50,
    innerTenDiameterMm: 25,
    blackDiameterMm: 200, // rings 7–10
    lowestRing: 1,
    defaultDistanceM: 25,
    defaultCaliberMm: 5.6,
  },
  {
    id: 'issf-rifle-50m',
    name: 'ISSF 50m rifle',
    kind: 'ring',
    tenDiameterMm: 10.4,
    ringStepMm: 16,
    innerTenDiameterMm: 5,
    blackDiameterMm: 112.4, // rings 3–10
    lowestRing: 1,
    defaultDistanceM: 50,
    defaultCaliberMm: 5.6,
  },
  {
    id: 'grid',
    name: 'Square grid paper',
    kind: 'grid',
    defaultDistanceM: 100,
    defaultCaliberMm: 6.5,
  },
  {
    id: 'manual',
    name: 'Other (set scale manually)',
    kind: 'manual',
    defaultDistanceM: 100,
    defaultCaliberMm: 6.5,
  },
];

export function getTarget(id: string): TargetDef {
  const t = TARGETS.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown target: ${id}`);
  return t;
}

export const CALIBERS: { label: string; mm: number }[] = [
  { label: '.22 LR (5.6 mm)', mm: 5.6 },
  { label: '4.5 mm air', mm: 4.5 },
  { label: '6.5 mm', mm: 6.5 },
  { label: '.308 / 7.62 mm', mm: 7.82 },
  { label: '9 mm', mm: 9.0 },
  { label: '.32 (7.65 mm)', mm: 7.9 },
  { label: '.38 / .357', mm: 9.1 },
  { label: '.45 ACP', mm: 11.5 },
];
