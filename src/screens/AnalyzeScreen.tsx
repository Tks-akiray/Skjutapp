import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomCanvas } from '../components/ZoomCanvas';
import { useBitmap } from '../components/useBitmap';
import { StatsPanel } from '../components/StatsPanel';
import { getTarget, type RingTarget } from '../targets/definitions';
import { groupStats } from '../analysis/stats';
import { ringRadii, scoreShots } from '../analysis/scoring';
import { mmToPx, pxToMm, type Point } from '../analysis/geometry';
import { detectShots } from '../detect';
import { encodeJpeg } from '../imageUtils';
import { saveSession } from '../storage/db';
import { newId, type Settings, type Shot, type StoredSession, type Work } from '../model';

interface Props {
  initial: Work;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onNew: () => void;
}

type Mode = 'shots' | 'aim';

const COLORS = {
  auto: '#20c4f4',
  uncertain: '#ff9f1c',
  manual: '#3ddc97',
  selected: '#ff3b6b',
  rings: 'rgba(32, 196, 244, 0.55)',
  group: '#ffd23f',
};

export function AnalyzeScreen({ initial, settings, onSettings, onNew }: Props) {
  const [work, setWork] = useState<Work>(initial);
  const [history, setHistory] = useState<Shot[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('shots');
  const [busy, setBusy] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(initial.sessionId ? initial.createdAt : null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = getTarget(work.targetId);
  const { calib, caliberMm } = work;
  const bitmap = useBitmap(calib.image);
  const stats = useMemo(() => groupStats(work.shots, caliberMm), [work.shots, caliberMm]);
  const score = useMemo(
    () => (target.kind === 'ring' ? scoreShots(target, work.shots, caliberMm) : null),
    [target, work.shots, caliberMm],
  );

  const update = useCallback(
    (patch: Partial<Work>, recordUndo = true) => {
      if (recordUndo && patch.shots) setHistory((h) => [...h.slice(-49), work.shots]);
      setWork((w) => ({ ...w, ...patch }));
      setDirty(true);
    },
    [work.shots],
  );

  const setShots = useCallback((shots: Shot[], recordUndo = true) => update({ shots }, recordUndo), [update]);

  const undo = useCallback(() => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setWork((w) => ({ ...w, shots: prev }));
    setSelected(null);
    setDirty(true);
  }, [history]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setShots(work.shots.filter((s) => s.id !== selected));
    setSelected(null);
  }, [selected, work.shots, setShots]);

  // Keyboard: Delete removes the selected shot, Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, undo]);

  const calPx = caliberMm * calib.pxPerMm;
  const shotPx = useCallback((s: Point) => mmToPx(s, calib.aimPx, calib.pxPerMm), [calib]);

  const hitTest = useCallback(
    (p: Point, scale: number) => {
      if (mode !== 'shots') return null;
      const r = Math.max(calPx / 2, 14 / scale);
      let best = -1;
      let bestD = Infinity;
      work.shots.forEach((s, i) => {
        const q = shotPx(s);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < r && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best >= 0 ? best : null;
    },
    [mode, calPx, work.shots, shotPx],
  );

  const onTap = useCallback(
    (p: Point, hit: number | null) => {
      if (mode === 'aim') {
        // Moving the aim point shifts every shot's coordinates (shots stay put on the image).
        const oldAim = calib.aimPx;
        const shots = work.shots.map((s) => {
          const px = mmToPx(s, oldAim, calib.pxPerMm);
          return { ...s, ...pxToMm(px, p, calib.pxPerMm) };
        });
        update({ calib: { ...calib, aimPx: p }, shots });
        setMode('shots');
        return;
      }
      if (hit !== null) {
        const id = work.shots[hit].id;
        setSelected((cur) => (cur === id ? null : id));
        return;
      }
      if (selected) {
        setSelected(null);
        return;
      }
      setShots([...work.shots, { id: newId(), ...pxToMm(p, calib.aimPx, calib.pxPerMm), auto: false }]);
    },
    [mode, calib, work.shots, selected, update, setShots],
  );

  // Offset between the pointer and the shot center when a drag starts, so the shot doesn't jump.
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const onDrag = useCallback(
    (i: number, p: Point, phase: 'start' | 'move' | 'end') => {
      const shot = work.shots[i];
      if (!shot) return;
      if (phase === 'start') {
        const c = mmToPx(shot, calib.aimPx, calib.pxPerMm);
        dragOffset.current = { x: c.x - p.x, y: c.y - p.y };
        setSelected(shot.id);
      }
      const dest = { x: p.x + dragOffset.current.x, y: p.y + dragOffset.current.y };
      const mm = pxToMm(dest, calib.aimPx, calib.pxPerMm);
      const moved = work.shots.map((s, j) => (j === i ? { ...s, ...mm, uncertain: false } : s));
      // One undo step per drag: record only at the start.
      setShots(moved, phase === 'start');
    },
    [work.shots, calib, setShots],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, { scale }: { scale: number }) => {
      const lw = 1.5 / scale;
      const aim = calib.aimPx;

      if (target.kind === 'ring') {
        ctx.strokeStyle = COLORS.rings;
        ctx.lineWidth = lw;
        for (const { r } of ringRadii(target as RingTarget)) {
          ctx.beginPath();
          ctx.arc(aim.x, aim.y, r * calib.pxPerMm, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Aim point.
      const a = 14 / scale;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.moveTo(aim.x - a, aim.y);
      ctx.lineTo(aim.x + a, aim.y);
      ctx.moveTo(aim.x, aim.y - a);
      ctx.lineTo(aim.x, aim.y + a);
      ctx.stroke();
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();

      if (stats.count >= 2) {
        const c = shotPx(stats.center);
        // Mean radius circle.
        ctx.setLineDash([6 / scale, 4 / scale]);
        ctx.strokeStyle = COLORS.group;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(c.x, c.y, stats.meanRadius * calib.pxPerMm, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Extreme spread.
        if (stats.extremeSpreadPair) {
          const [i, j] = stats.extremeSpreadPair;
          const p = shotPx(work.shots[i]);
          const q = shotPx(work.shots[j]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        // Group center.
        const g = 9 / scale;
        ctx.lineWidth = 2.5 / scale;
        ctx.beginPath();
        ctx.moveTo(c.x - g, c.y - g);
        ctx.lineTo(c.x + g, c.y + g);
        ctx.moveTo(c.x + g, c.y - g);
        ctx.lineTo(c.x - g, c.y + g);
        ctx.stroke();
      }

      // Shots.
      const r = Math.max(calPx / 2, 7 / scale);
      ctx.font = `600 ${12 / scale}px system-ui, sans-serif`;
      work.shots.forEach((s, i) => {
        const p = shotPx(s);
        const color =
          s.id === selected ? COLORS.selected : !s.auto ? COLORS.manual : s.uncertain ? COLORS.uncertain : COLORS.auto;
        ctx.lineWidth = (s.id === selected ? 3 : 2) / scale;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 1 / scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8 / scale, 0, Math.PI * 2);
        ctx.fill();
        const label = String(i + 1);
        const tx = p.x + r + 3 / scale;
        const ty = p.y - r * 0.6;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(label, tx, ty);
        ctx.fillText(label, tx, ty);
      });
    },
    [calib, target, stats, work.shots, selected, calPx, shotPx],
  );

  const redetect = async () => {
    setError(null);
    setBusy('Finding bullet holes…');
    try {
      const found = await detectShots(calib, target, caliberMm, settings.sensitivity);
      // Keep shots added by hand; replace the auto-detected ones.
      setShots([...work.shots.filter((s) => !s.auto), ...found]);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    setBusy('Saving…');
    try {
      const [image, thumb] = await Promise.all([encodeJpeg(calib.image, Infinity, 0.88), encodeJpeg(calib.image, 320, 0.8)]);
      const id = work.sessionId ?? newId();
      const now = Date.now();
      const session: StoredSession = {
        id,
        createdAt: work.createdAt,
        updatedAt: now,
        targetId: work.targetId,
        distanceM: work.distanceM,
        caliberMm: work.caliberMm,
        notes: work.notes,
        shots: work.shots,
        pxPerMm: calib.pxPerMm,
        aimPx: calib.aimPx,
        image,
        thumb,
        summary: {
          count: stats.count,
          extremeSpreadMm: stats.extremeSpread,
          meanRadiusMm: stats.meanRadius,
          offsetXMm: stats.center.x,
          offsetYMm: stats.center.y,
          score: score?.total,
          decimalScore: score?.decimalTotal,
          xCount: score?.xCount,
        },
      };
      await saveSession(session);
      setWork((w) => ({ ...w, sessionId: id }));
      setSavedAt(now);
      setDirty(false);
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const uncertainCount = work.shots.filter((s) => s.uncertain).length;

  return (
    <div className="workspace">
      <div className="canvas-area">
        <ZoomCanvas
          image={bitmap}
          draw={draw}
          hitTest={hitTest}
          onTap={onTap}
          onDrag={mode === 'shots' ? onDrag : undefined}
          redrawKey={draw}
          className={mode === 'aim' ? 'crosshair' : undefined}
        />
        <div className="canvas-toolbar">
          <button type="button" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={deleteSelected} disabled={!selected} title="Delete selected shot (Del)">
            Delete shot
          </button>
          <button
            type="button"
            className={mode === 'aim' ? 'active' : ''}
            onClick={() => setMode((m) => (m === 'aim' ? 'shots' : 'aim'))}
            title="Tap the image to set the point of aim"
          >
            {mode === 'aim' ? 'Tap aim point…' : 'Set aim point'}
          </button>
        </div>
      </div>

      <aside className="panel">
        <div className="panel-head">
          <h2>{target.name}</h2>
          <p className="sub">
            {work.distanceM} m · Ø{work.caliberMm} mm · {new Date(work.createdAt).toLocaleDateString()}
          </p>
        </div>

        <p className="hint small">
          Tap to add a shot, tap a shot to select it, drag to move. Pinch or scroll to zoom.
          {uncertainCount > 0 && (
            <>
              {' '}
              <span className="badge uncertain">{uncertainCount} to check</span> (orange) may be overlapping holes.
            </>
          )}
        </p>
        {target.kind !== 'ring' && (
          <p className="hint small">
            The aim point (red cross) starts at the center of {target.kind === 'grid' ? 'the marked rectangle' : 'the photo'} —
            use <strong>Set aim point</strong> to move it to where you aimed.
          </p>
        )}
        {target.kind === 'ring' && calib.refined === false && (
          <p className="warn small">Perspective could not be refined from the ring lines; scores near a ring edge may be off.</p>
        )}

        <StatsPanel
          stats={stats}
          score={score}
          distanceM={work.distanceM}
          settings={settings}
          onSettings={onSettings}
        />

        <details className="detect-box">
          <summary>Detection</summary>
          <label className="slider">
            Sensitivity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.sensitivity}
              onChange={(e) => onSettings({ ...settings, sensitivity: parseFloat(e.target.value) })}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={redetect} disabled={!!busy}>
              Re-detect holes
            </button>
            <button type="button" onClick={() => setShots(work.shots.filter((s) => !s.auto))} disabled={!work.shots.some((s) => s.auto)}>
              Remove auto shots
            </button>
          </div>
          <p className="hint small">Re-detect keeps shots you added by hand.</p>
        </details>

        <label className="notes">
          Notes
          <textarea
            rows={2}
            value={work.notes}
            placeholder="Ammo, conditions, position…"
            onChange={(e) => update({ notes: e.target.value }, false)}
          />
        </label>

        <div className="button-row end">
          <button type="button" onClick={onNew}>
            New group
          </button>
          <button type="button" className="primary" onClick={save} disabled={!!busy || (!dirty && !!savedAt)}>
            {savedAt && !dirty ? 'Saved ✓' : work.sessionId ? 'Save changes' : 'Save session'}
          </button>
        </div>
        {busy && <p className="status">{busy}</p>}
        {error && <p className="error">{error}</p>}
      </aside>
    </div>
  );
}
