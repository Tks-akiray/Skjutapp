import { createRequire } from 'node:module';
import type { CV } from '../src/vision/cv';

/**
 * Load OpenCV.js through require(): Vitest's ESM module runner hangs on this package
 * because its default export is a thenable Emscripten module.
 */
export function loadCvNode(): Promise<CV> {
  const require = createRequire(import.meta.url);
  const mod = require('@techstark/opencv-js') as CV & { then?: unknown };
  return new Promise((resolve) => {
    const done = () => {
      delete mod.then;
      resolve(mod);
    };
    if (typeof mod.Mat === 'function') done();
    else mod.onRuntimeInitialized = done;
  });
}
