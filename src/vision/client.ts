import type { VisionApi, VisionMethod, VisionResponse } from './protocol';

/** Promise-based client for the OpenCV worker. One worker, created lazily. */
class VisionClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.readyPromise = new Promise((r) => (this.readyResolve = r));
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<VisionResponse>) => {
      const msg = ev.data;
      if (msg.id === -1) {
        this.readyResolve?.();
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    };
    w.onerror = (ev) => {
      const err = new Error(ev.message || 'Vision worker failed');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  /** Start loading OpenCV in the background (it is ~10 MB). */
  warmUp(): Promise<void> {
    this.ensure();
    return this.readyPromise!;
  }

  call<M extends VisionMethod>(method: M, args: VisionApi[M]['args']): Promise<VisionApi[M]['result']> {
    const w = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      // Images are copied (structured clone) so the caller keeps its own copy.
      w.postMessage({ id, method, args });
    });
  }
}

export const vision = new VisionClient();
