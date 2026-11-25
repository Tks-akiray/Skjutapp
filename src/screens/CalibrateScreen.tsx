import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZoomCanvas } from '../components/ZoomCanvas';
import { useBitmap } from '../components/useBitmap';
import { getTarget } from '../targets/definitions';
import { vision } from '../vision/client';
import { rectifyByScale, type Ellipse } from '../vision/rectify';
import { detectShots } from '../detect';
import { toImageData } from '../imageUtils';
import type { Point } from '../analysis/geometry';
import { orderQuad, squareToQuad } from '../analysis/quad';
import type { Calibration, Settings, Work } from '../model';
import type { Setup } from './ImportScreen';

interface Props {
  setup: Setup;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onBack: () => void;
  onDone: (work: Work) => void;
}

const fmtMm = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function CalibrateScreen({ setup, settings, onSettings, onBack, onDone }: Props) {
  const target = getTarget(setup.targetId);
  const bitmap = useBitmap(setup.photo);
  const [points, setPoints] = useState<Point[]>([]);
  const [ellipse, setEllipse] = useState<Ellipse | null>(null);
  const [autoState, setAutoState] = useState<'idle' | 'running' | 'found' | 'notfound'>('idle');
  const [confidence, setConfidence] = useState(0);
  const [manualEdge, setManualEdge] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scaleMm, setScaleMm] = useState(100);
  // Square counts default to 1 (one marked square) and are not remembered: a stale count
  // silently scales every measurement.
  const [squaresX, setSquaresX] = useState(1);
  const [squaresY, setSquaresY] = useState(1);
  const squareMm = settings.grid.squareMm;
  const setSquareMm = (v: number) => onSettings({ ...settings, grid: { squareMm: v } });

  // Ring targets: find the black aiming mark automatically.
  useEffect(() => {
    if (target.kind !== 'ring') return;
    let cancelled = false;
    setAutoState('running');
    vision
      .call('findAim', { image: setup.photo })
      .then((r) => {
        if (cancelled) return;
        if (r && r.confidence >= 0.3) {
          setEllipse(r.ellipse);
          setConfidence(r.confidence);
          setAutoState('found');
        } else {
          setAutoState('notfound');
          setManualEdge(true);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [setup.photo, target.kind]);

  // Manual edge points → ellipse.
  useEffect(() => {
    if (target.kind !== 'ring' || !manualEdge) return;
    if (points.length < 3) {
      setEllipse(null);
      return;
    }
    let cancelled = false;
    vision.call('fitEdge', { points }).then((e) => !cancelled && setEllipse(e));
    return () => {
      cancelled = true;
    };
  }, [points, manualEdge, target.kind]);

  const maxPoints = target.kind === 'grid' ? 4 : target.kind === 'manual' ? 2 : manualEdge ? 24 : 0;

  const onTap = useCallback(
    (p: Point, hit: number | null) => {
      if (hit !== null || maxPoints === 0) return;
      setPoints((pts) => (pts.length < maxPoints ? [...pts, p] : pts));
    },
    [maxPoints],
  );

  const hitTest = useCallback(
    (p: Point, scale: number) => {
      const r = 18 / scale;
      const i = points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < r);
      return i >= 0 ? i : null;
    },
    [points],
  );

  const onDrag = useCallback((i: number, p: Point) => {
    setPoints((pts) => pts.map((q, j) => (j === i ? p : q)));
  }, []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, { scale }: { scale: number }) => {
      const lw = 2 / scale;
      if (ellipse) {
        ctx.save();
        ctx.strokeStyle = '#3ddc97';
        ctx.lineWidth = lw * 1.5;
        ctx.setLineDash([8 / scale, 6 / scale]);
        ctx.beginPath();
        ctx.ellipse(ellipse.cx, ellipse.cy, ellipse.w / 2, ellipse.h / 2, (ellipse.angle * Math.PI) / 180, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const s = 10 / scale;
        ctx.beginPath();
        ctx.moveTo(ellipse.cx - s, ellipse.cy);
        ctx.lineTo(ellipse.cx + s, ellipse.cy);
        ctx.moveTo(ellipse.cx, ellipse.cy - s);
        ctx.lineTo(ellipse.cx, ellipse.cy + s);
        ctx.stroke();
        ctx.restore();
      }
      if (target.kind === 'grid' && points.length >= 2) {
        const quad = points.length === 4 ? orderQuad(points) : points;
        ctx.strokeStyle = '#3ddc97';
        ctx.lineWidth = lw * 1.5;
        ctx.beginPath();
        quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (quad.length === 4) ctx.closePath();
        ctx.stroke();
        // Preview of the squares the app assumes inside the marked area; they should line
        // up with the printed grid.
        if (quad.length === 4 && squaresX > 0 && squaresY > 0 && squaresX * squaresY <= 2500) {
          const map = squareToQuad(quad as [Point, Point, Point, Point]);
          ctx.lineWidth = lw;
          ctx.setLineDash([5 / scale, 4 / scale]);
          ctx.beginPath();
          for (let i = 1; i < squaresX; i++) {
            const a = map(i / squaresX, 0);
            const b = map(i / squaresX, 1);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          for (let j = 1; j < squaresY; j++) {
            const a = map(0, j / squaresY);
            const b = map(1, j / squaresY);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (target.kind === 'manual' && points.length === 2) {
        ctx.strokeStyle = '#3ddc97';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
      }
      points.forEach((p, i) => {
        ctx.fillStyle = 'rgba(255, 196, 0, 0.35)';
        ctx.strokeStyle = '#ffc400';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 / scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffc400';
        ctx.fill();
        if (target.kind !== 'ring') {
          ctx.font = `${13 / scale}px system-ui, sans-serif`;
          ctx.fillText(String(i + 1), p.x + 14 / scale, p.y - 10 / scale);
        }
      });
    },
    [ellipse, points, target.kind, squaresX, squaresY],
  );

  const ready =
    target.kind === 'ring'
      ? !!ellipse
      : target.kind === 'grid'
        ? points.length === 4 && squaresX > 0 && squaresY > 0 && squareMm > 0
        : points.length === 2 && scaleMm > 0;

  const proceed = async () => {
    setError(null);
    try {
      let calib: Calibration;
      if (target.kind === 'ring') {
        setBusy('Straightening target…');
        const r = await vision.call('rectifyRing', { image: setup.photo, ellipse: ellipse!, targetId: target.id });
        calib = { image: toImageData(r.image), pxPerMm: r.pxPerMm, aimPx: r.aimPx, refined: r.refined, residualMm: r.residualMm };
      } else if (target.kind === 'grid') {
        setBusy('Straightening grid…');
        const r = await vision.call('rectifyQuad', {
          image: setup.photo,
          corners: orderQuad(points),
          widthMm: squaresX * squareMm,
          heightMm: squaresY * squareMm,
        });
        calib = { image: toImageData(r.image), pxPerMm: r.pxPerMm, aimPx: r.aimPx };
      } else {
        const r = rectifyByScale(setup.photo, points[0], points[1], scaleMm);
        calib = { image: setup.photo, pxPerMm: r.pxPerMm, aimPx: r.aimPx };
      }
      setBusy('Finding bullet holes…');
      const shots = await detectShots(calib, target, setup.caliberMm, settings.sensitivity);
      onDone({
        createdAt: Date.now(),
        targetId: target.id,
        distanceM: setup.distanceM,
        caliberMm: setup.caliberMm,
        notes: '',
        calib,
        shots,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const instructions = useMemo(() => {
    if (target.kind === 'ring') {
      if (autoState === 'running') return 'Looking for the black aiming mark…';
      if (!manualEdge)
        return `Found the aiming mark (${Math.round(confidence * 100)}% match). Check that the dashed outline follows the edge of the black.`;
      return autoState === 'notfound'
        ? 'Could not find the aiming mark. Tap at least 5 points around the edge of the black circle.'
        : 'Tap at least 5 points around the edge of the black circle. Drag points to adjust.';
    }
    if (target.kind === 'grid')
      return 'Tap the 4 corners of a square (or a block of squares) on the grid, in any order. Drag to adjust; zoom in for precision. Then enter the square size and how many squares the marked area spans.';
    return 'Tap two points a known distance apart (e.g. a ruler or the target edge), then enter the distance.';
  }, [target.kind, autoState, manualEdge, confidence]);

  return (
    <div className="workspace">
      <div className="canvas-area">
        <ZoomCanvas
          image={bitmap}
          draw={draw}
          hitTest={hitTest}
          onTap={onTap}
          onDrag={onDrag}
          redrawKey={[points, ellipse]}
        />
      </div>
      <aside className="panel">
        <h2>Calibrate</h2>
        <p className="hint">{instructions}</p>

        {target.kind === 'ring' && autoState !== 'running' && (
          <div className="button-row">
            {!manualEdge ? (
              <button type="button" onClick={() => { setManualEdge(true); setPoints([]); setEllipse(null); }}>
                Mark edge manually
              </button>
            ) : (
              <button type="button" disabled={points.length === 0} onClick={() => setPoints([])}>
                Clear points ({points.length})
              </button>
            )}
          </div>
        )}

        {target.kind === 'grid' && (
          <>
            <div className="form-row">
              <label>
                Square size (mm)
                <input type="number" min={0.1} step={0.1} value={squareMm} onChange={(e) => setSquareMm(parseFloat(e.target.value) || 0)} />
              </label>
              <label>
                Squares across in marked area
                <input type="number" min={1} step={1} value={squaresX} onChange={(e) => setSquaresX(parseInt(e.target.value) || 0)} />
              </label>
              <label>
                Squares down in marked area
                <input type="number" min={1} step={1} value={squaresY} onChange={(e) => setSquaresY(parseInt(e.target.value) || 0)} />
              </label>
            </div>
            <p className="scale-summary">
              Marked area = <strong>{fmtMm(squaresX * squareMm)} × {fmtMm(squaresY * squareMm)} mm</strong>
              {(squaresX > 1 || squaresY > 1) && ' — the dashed lines should match the printed grid.'}
            </p>
            <div className="button-row">
              <button type="button" disabled={points.length === 0} onClick={() => setPoints([])}>
                Clear corners
              </button>
            </div>
          </>
        )}

        {target.kind === 'manual' && (
          <div className="form-row">
            <label>
              Distance between points (mm)
              <input type="number" min={0.1} step={0.1} value={scaleMm} onChange={(e) => setScaleMm(parseFloat(e.target.value) || 0)} />
            </label>
            <button type="button" disabled={points.length === 0} onClick={() => setPoints([])}>
              Clear points
            </button>
          </div>
        )}

        <div className="button-row end">
          <button type="button" onClick={onBack}>
            Back
          </button>
          <button type="button" className="primary" disabled={!ready || !!busy} onClick={proceed}>
            Continue
          </button>
        </div>
        {busy && <p className="status">{busy}</p>}
        {error && <p className="error">{error}</p>}
      </aside>
    </div>
  );
}
