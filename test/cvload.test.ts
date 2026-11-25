import { expect, it } from 'vitest';
import { loadCvNode } from './cvNode';

it('loads OpenCV', async () => {
  const cv = await loadCvNode();
  const m = new cv.Mat(10, 10, cv.CV_8UC1);
  expect(m.rows).toBe(10);
  m.delete();
});
