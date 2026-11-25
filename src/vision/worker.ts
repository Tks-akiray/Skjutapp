/// <reference lib="webworker" />
import { loadCv, type RGBAImage } from './cv';
import { findAimMark, fitEllipseToPoints, rectifyByQuad, rectifyRingTarget } from './rectify';
import { detectHoles } from './detectHoles';
import { getTarget, type RingTarget } from '../targets/definitions';
import type { VisionApi, VisionMethod, VisionRequest, VisionResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const cvReady = loadCv();
cvReady.then(() => self.postMessage({ id: -1, ok: true, result: 'ready' } satisfies VisionResponse));

type Handlers = { [M in VisionMethod]: (args: VisionApi[M]['args']) => VisionApi[M]['result'] };

function handlers(cv: Awaited<typeof cvReady>): Handlers {
  return {
    findAim: ({ image }) => findAimMark(cv, image),
    fitEdge: ({ points }) => fitEllipseToPoints(cv, points),
    rectifyRing: ({ image, ellipse, targetId }) =>
      rectifyRingTarget(cv, image, ellipse, getTarget(targetId) as RingTarget),
    rectifyQuad: ({ image, corners, widthMm, heightMm }) => rectifyByQuad(cv, image, corners, widthMm, heightMm),
    detect: ({ image, opts }) => detectHoles(cv, image, opts),
  };
}

self.onmessage = async (ev: MessageEvent<VisionRequest>) => {
  const { id, method, args } = ev.data;
  try {
    const cv = await cvReady;
    const fn = handlers(cv)[method] as (a: typeof args) => unknown;
    const result = fn(args);
    // Hand image buffers back without copying.
    const transfer: Transferable[] = [];
    const img = (result as { image?: RGBAImage } | null)?.image;
    if (img?.data) transfer.push(img.data.buffer as ArrayBuffer);
    self.postMessage({ id, ok: true, result } satisfies VisionResponse, transfer);
  } catch (e) {
    const error = e instanceof Error ? e.message : typeof e === 'number' ? `OpenCV error ${e}` : String(e);
    self.postMessage({ id, ok: false, error } satisfies VisionResponse);
  }
};
