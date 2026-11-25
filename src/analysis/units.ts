export type AngularUnit = 'MOA' | 'MRAD';

/** Linear size (mm) at distance (m) → milliradians. 1 mrad = 1 mm at 1 m. */
export const mmToMrad = (mm: number, distanceM: number): number => mm / distanceM;

/** Linear size (mm) at distance (m) → true minutes of angle. */
export const mmToMoa = (mm: number, distanceM: number): number =>
  (Math.atan(mm / (distanceM * 1000)) * 180 * 60) / Math.PI;

export const mmToAngular = (mm: number, distanceM: number, unit: AngularUnit): number =>
  unit === 'MOA' ? mmToMoa(mm, distanceM) : mmToMrad(mm, distanceM);

export interface Correction {
  /** Clicks to apply. Positive = UP / RIGHT. */
  elevationClicks: number;
  windageClicks: number;
}

/**
 * Sight correction that moves the group center onto the aim point.
 * `offsetMm` is group center relative to aim, with y pointing DOWN (image convention).
 * A group that is low (y > 0) needs the sight adjusted UP, a group to the right needs LEFT.
 */
export function sightCorrection(
  offsetMm: { x: number; y: number },
  distanceM: number,
  unit: AngularUnit,
  clickValue: number,
): Correction {
  const elev = mmToAngular(offsetMm.y, distanceM, unit) / clickValue;
  const wind = -mmToAngular(offsetMm.x, distanceM, unit) / clickValue;
  return { elevationClicks: elev, windageClicks: wind };
}
