import { describe, expect, it } from 'vitest';
import { orderQuad, squareToQuad } from '../src/analysis/quad';

describe('orderQuad', () => {
  it('orders corners TL, TR, BR, BL from any tap order', () => {
    const tl = { x: 10, y: 12 }, tr = { x: 110, y: 8 }, br = { x: 105, y: 115 }, bl = { x: 12, y: 108 };
    expect(orderQuad([br, tl, bl, tr])).toEqual([tl, tr, br, bl]);
  });
});

describe('squareToQuad', () => {
  it('maps the unit square corners onto the quad', () => {
    const q = [{ x: 10, y: 12 }, { x: 110, y: 8 }, { x: 95, y: 115 }, { x: 12, y: 100 }] as const;
    const m = squareToQuad([...q] as never);
    const corners = [m(0, 0), m(1, 0), m(1, 1), m(0, 1)];
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(q[i].x, 9);
      expect(c.y).toBeCloseTo(q[i].y, 9);
    });
  });
  it('is the plain grid for an axis-aligned square', () => {
    const m = squareToQuad([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    expect(m(0.25, 0.5)).toEqual({ x: 25, y: 50 });
  });
});
