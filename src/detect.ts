import { pxToMm } from './analysis/geometry';
import { scoringDiameter, type TargetDef } from './targets/definitions';
import { vision } from './vision/client';
import { newId, type Calibration, type Shot } from './model';

/** Run hole detection on a calibrated image and return shots in mm. */
export async function detectShots(
  calib: Calibration,
  target: TargetDef,
  caliberMm: number,
  sensitivity: number,
): Promise<Shot[]> {
  const { pxPerMm, aimPx } = calib;
  const ring = target.kind === 'ring';
  const holes = await vision.call('detect', {
    image: calib.image,
    opts: {
      pxPerMm,
      caliberMm,
      sensitivity,
      black: ring ? { cx: aimPx.x, cy: aimPx.y, r: (target.blackDiameterMm / 2) * pxPerMm } : undefined,
      roi: ring
        ? { cx: aimPx.x, cy: aimPx.y, r: (scoringDiameter(target) / 2 + caliberMm) * pxPerMm }
        : undefined,
    },
  });
  return holes.map((h) => ({ id: newId(), ...pxToMm(h, aimPx, pxPerMm), auto: true, uncertain: h.uncertain }));
}
