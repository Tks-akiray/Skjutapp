import { useCallback, useEffect, useRef } from 'react';
import type { Point } from '../analysis/geometry';

export interface DrawInfo {
  /** Screen pixels per image pixel. Divide stroke widths by this for constant on-screen size. */
  scale: number;
}

export interface ZoomCanvasProps {
  image: ImageBitmap | null;
  /** Draw overlays; the context is already transformed to image coordinates. */
  draw?: (ctx: CanvasRenderingContext2D, info: DrawInfo) => void;
  /** Return the index of a draggable/selectable item under the point (image coords). */
  hitTest?: (p: Point, scale: number) => number | null;
  onTap?: (p: Point, hit: number | null) => void;
  onDrag?: (index: number, p: Point, phase: 'start' | 'move' | 'end') => void;
  /** Change this to trigger a redraw when overlay data changes. */
  redrawKey?: unknown;
  /** Change this to re-fit the image to the view. */
  fitKey?: unknown;
  className?: string;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

const TAP_SLOP = 6; // px of movement before a press becomes a pan/drag

/**
 * Canvas that shows an image with pan (drag), zoom (wheel / pinch) and tap / drag
 * interactions in image coordinates.
 */
export function ZoomCanvas({ image, draw, hitTest, onTap, onDrag, redrawKey, fitKey, className }: ZoomCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const frame = useRef(0);
  /** True once the user pans/zooms; until then the image re-fits on resize. */
  const userMoved = useRef(false);
  const props = useRef({ draw, hitTest, onTap, onDrag, image });
  props.current = { draw, hitTest, onTap, onDrag, image };

  const render = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const { dpr } = size.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      const img = props.current.image;
      if (!img) return;
      const v = view.current;
      ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.tx, dpr * v.ty);
      ctx.imageSmoothingEnabled = v.scale < 2;
      ctx.drawImage(img, 0, 0);
      props.current.draw?.(ctx, { scale: v.scale });
    });
  }, []);

  const fit = useCallback(() => {
    const img = props.current.image;
    const { w, h } = size.current;
    if (!img || !w || !h) return;
    const s = Math.min(w / img.width, h / img.height) * 0.98;
    view.current = { scale: s, tx: (w - img.width * s) / 2, ty: (h - img.height * s) / 2 };
    userMoved.current = false;
    render();
  }, [render]);

  // Resize handling.
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const prev = size.current;
      size.current = { w: r.width, h: r.height, dpr };
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      if (!userMoved.current) fit();
      else {
        // Keep the same image point at the view center.
        view.current.tx += (r.width - prev.w) / 2;
        view.current.ty += (r.height - prev.h) / 2;
        render();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, render]);

  useEffect(() => fit(), [image, fitKey, fit]);
  useEffect(() => render(), [redrawKey, draw, render]);

  // Pointer interaction.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'press' | 'pan' | 'drag' | 'pinch' = 'none';
    let start = { x: 0, y: 0 };
    let hit: number | null = null;
    let pinch = { dist: 0, mid: { x: 0, y: 0 } };

    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toImage = (p: { x: number; y: number }): Point => ({
      x: (p.x - view.current.tx) / view.current.scale,
      y: (p.y - view.current.ty) / view.current.scale,
    });
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    const zoomAt = (p: { x: number; y: number }, factor: number) => {
      const v = view.current;
      const img = props.current.image;
      const minS = img ? (Math.min(size.current.w / img.width, size.current.h / img.height) * 0.5) : 0.01;
      const s = Math.max(minS, Math.min(40, v.scale * factor));
      const k = s / v.scale;
      view.current = { scale: s, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k };
      userMoved.current = true;
    };

    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        if (mode === 'drag' && hit !== null) props.current.onDrag?.(hit, toImage(start), 'end');
        mode = 'pinch';
        pinch = pinchState();
        return;
      }
      if (pointers.size > 2) return;
      start = local(e);
      const ip = toImage(start);
      hit = props.current.hitTest?.(ip, view.current.scale) ?? null;
      mode = 'press';
    };

    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, p);
      if (mode === 'pinch' && pointers.size === 2) {
        const now = pinchState();
        userMoved.current = true;
        view.current.tx += now.mid.x - pinch.mid.x;
        view.current.ty += now.mid.y - pinch.mid.y;
        if (pinch.dist > 0) zoomAt(now.mid, now.dist / pinch.dist);
        pinch = now;
        render();
        return;
      }
      if (mode === 'press' && Math.hypot(p.x - start.x, p.y - start.y) > TAP_SLOP) {
        if (hit !== null && props.current.onDrag) {
          mode = 'drag';
          props.current.onDrag(hit, toImage(start), 'start');
        } else {
          mode = 'pan';
        }
      }
      if (mode === 'pan') {
        userMoved.current = true;
        view.current.tx += p.x - prev.x;
        view.current.ty += p.y - prev.y;
        render();
      } else if (mode === 'drag' && hit !== null) {
        props.current.onDrag?.(hit, toImage(p), 'move');
      }
    };

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.delete(e.pointerId);
      if (mode === 'press') {
        props.current.onTap?.(toImage(p), hit);
      } else if (mode === 'drag' && hit !== null) {
        props.current.onDrag?.(hit, toImage(p), 'end');
      }
      if (pointers.size === 0) mode = 'none';
      else if (mode === 'pinch') mode = 'none'; // remaining finger does nothing until lifted
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(local(e), Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      render();
    };

    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel);
    };
  }, [render]);

  return (
    <div ref={wrapRef} className={`zoom-canvas ${className ?? ''}`}>
      <canvas ref={canvasRef} />
      <div className="zoom-controls">
        <button type="button" aria-label="Zoom in" onClick={() => { zoomAtCenter(view, size.current.w, size.current.h, 1.5, userMoved); render(); }}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => { zoomAtCenter(view, size.current.w, size.current.h, 1 / 1.5, userMoved); render(); }}>−</button>
        <button type="button" aria-label="Fit image" onClick={fit}>⤢</button>
      </div>
    </div>
  );
}

function zoomAtCenter(view: { current: View }, w: number, h: number, factor: number, moved: { current: boolean }) {
  moved.current = true;
  const v = view.current;
  const p = { x: w / 2, y: h / 2 };
  const s = Math.max(0.01, Math.min(40, v.scale * factor));
  const k = s / v.scale;
  view.current = { scale: s, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k };
}
