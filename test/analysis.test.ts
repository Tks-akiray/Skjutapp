import { describe, expect, it } from 'vitest';
import { groupStats } from '../src/analysis/stats';
import { mmToMoa, mmToMrad, sightCorrection } from '../src/analysis/units';
import { scoreShot, scoreShots } from '../src/analysis/scoring';
import { getTarget, ringDiameter, type RingTarget } from '../src/targets/definitions';

const pistol = getTarget('issf-pistol-precision') as RingTarget;
const rifle = getTarget('issf-rifle-50m') as RingTarget;

describe('units', () => {
  it('1 mrad = 1 mm at 1 m, 100 mm at 100 m', () => {
    expect(mmToMrad(100, 100)).toBeCloseTo(1, 10);
  });
  it('1 MOA ≈ 29.09 mm at 100 m', () => {
    expect(mmToMoa(29.0888, 100)).toBeCloseTo(1, 3);
  });
  it('sight correction: low-right group → up and left', () => {
    // 10 mm low, 20 mm right at 100 m, 0.1 mrad clicks
    const c = sightCorrection({ x: 20, y: 10 }, 100, 'MRAD', 0.1);
    expect(c.elevationClicks).toBeCloseTo(1, 6); // up
    expect(c.windageClicks).toBeCloseTo(-2, 6); // left
  });
});

describe('groupStats', () => {
  it('handles empty and single-shot groups', () => {
    expect(groupStats([], 5.6).count).toBe(0);
    const one = groupStats([{ x: 3, y: 4 }], 5.6);
    expect(one.extremeSpread).toBe(0);
    expect(one.offsetDistance).toBeCloseTo(5);
  });

  it('square of four shots', () => {
    const s = groupStats(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      5,
    );
    expect(s.extremeSpread).toBeCloseTo(Math.SQRT2 * 10);
    expect(s.outsideToOutside).toBeCloseTo(Math.SQRT2 * 10 + 5);
    expect(s.center).toEqual({ x: 5, y: 5 });
    expect(s.meanRadius).toBeCloseTo(Math.SQRT2 * 5);
    expect(s.width).toBe(10);
    expect(s.height).toBe(10);
    expect(s.extremeSpreadPair).toEqual([0, 2]);
  });
});

describe('ring dimensions', () => {
  it('pistol target: 1 ring is 500 mm', () => expect(ringDiameter(pistol, 1)).toBe(500));
  it('rifle target: 1 ring is 154.4 mm', () => expect(ringDiameter(rifle, 1)).toBeCloseTo(154.4));
});

describe('scoring', () => {
  const cal = 5.6;
  it('center shot is 10, X, 10.9', () => {
    expect(scoreShot(pistol, { x: 0, y: 0 }, cal)).toEqual({ ring: 10, x: true, decimal: 10.9 });
  });

  it('hole touching the 10-ring line scores 10 (pistol)', () => {
    // 10 ring radius 25 mm; hole edge exactly on line
    expect(scoreShot(pistol, { x: 25 + cal / 2, y: 0 }, cal).ring).toBe(10);
    expect(scoreShot(pistol, { x: 25 + cal / 2 + 0.01, y: 0 }, cal).ring).toBe(9);
  });

  it('ring boundaries (pistol)', () => {
    // 7 ring radius = 100 mm
    expect(scoreShot(pistol, { x: 0, y: 100 + cal / 2 }, cal).ring).toBe(7);
    expect(scoreShot(pistol, { x: 0, y: 100 + cal / 2 + 0.1 }, cal).ring).toBe(6);
    // outside the 1 ring (radius 250)
    expect(scoreShot(pistol, { x: 250 + cal / 2 + 0.1, y: 0 }, cal).ring).toBe(0);
    expect(scoreShot(pistol, { x: 250 + cal / 2, y: 0 }, cal).ring).toBe(1);
  });

  it('inner ten (rifle, X radius 2.5 mm)', () => {
    expect(scoreShot(rifle, { x: 2.5 + cal / 2, y: 0 }, cal).x).toBe(true);
    expect(scoreShot(rifle, { x: 2.5 + cal / 2 + 0.05, y: 0 }, cal).x).toBe(false);
  });

  it('decimal values stay within the integer ring', () => {
    for (let r = 0; r < 160; r += 0.37) {
      const s = scoreShot(rifle, { x: r, y: 0 }, cal);
      if (s.ring > 0) {
        expect(s.decimal).toBeGreaterThanOrEqual(s.ring);
        expect(s.decimal).toBeLessThan(s.ring + 1);
      } else {
        expect(s.decimal).toBe(0);
      }
    }
  });

  it('decimal: touching 10 ring = 10.0, half a ring in = 10.5 (rifle)', () => {
    expect(scoreShot(rifle, { x: 5.2 + cal / 2, y: 0 }, cal).decimal).toBe(10.0);
    expect(scoreShot(rifle, { x: 5.2 + cal / 2 - 4, y: 0 }, cal).decimal).toBe(10.5);
  });

  it('summary totals', () => {
    const s = scoreShots(pistol, [
      { x: 0, y: 0 },
      { x: 40, y: 0 }, // edge at 37.2 mm → 9
      { x: 400, y: 0 },
    ], cal);
    expect(s.total).toBe(10 + 9 + 0);
    expect(s.xCount).toBe(1);
  });
});
