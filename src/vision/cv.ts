import cvModule from '@techstark/opencv-js';

export type CV = typeof cvModule;

let ready: Promise<CV> | null = null;

/**
 * Resolve the OpenCV.js runtime once it is initialized (browser worker and Node).
 * The Emscripten module is a "thenable" whose then() resolves with itself, so it must
 * never be passed to resolve() as is — we remove then() once the runtime is ready.
 */
export function loadCv(): Promise<CV> {
  if (!ready) {
    ready = new Promise<CV>((resolve) => {
      const mod = cvModule as unknown as CV & { then?: unknown };
      const done = () => {
        // Strip the self-resolving then() so the module can travel through promises.
        delete mod.then;
        resolve(mod);
      };
      if (typeof mod.Mat === 'function') done();
      else mod.onRuntimeInitialized = done;
    });
  }
  return ready;
}

/** Minimal RGBA image, compatible with DOM ImageData. */
export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
