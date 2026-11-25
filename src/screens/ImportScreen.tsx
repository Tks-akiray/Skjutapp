import { useRef, useState } from 'react';
import { CALIBERS, TARGETS, getTarget } from '../targets/definitions';
import { loadImageFile } from '../imageUtils';
import type { Settings } from '../model';

export interface Setup {
  targetId: string;
  distanceM: number;
  caliberMm: number;
  photo: ImageData;
}

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onStart: (setup: Setup) => void;
}

export function ImportScreen({ settings, onSettings, onStart }: Props) {
  const [targetId, setTargetId] = useState(settings.lastTargetId);
  const target = getTarget(targetId);
  const remembered = settings.perTarget[targetId];
  const [distanceM, setDistanceM] = useState(remembered?.distanceM ?? target.defaultDistanceM);
  const [caliberMm, setCaliberMm] = useState(remembered?.caliberMm ?? target.defaultCaliberMm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickTarget = (id: string) => {
    setTargetId(id);
    const t = getTarget(id);
    const r = settings.perTarget[id];
    setDistanceM(r?.distanceM ?? t.defaultDistanceM);
    setCaliberMm(r?.caliberMm ?? t.defaultCaliberMm);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const photo = await loadImageFile(file);
      onSettings({
        ...settings,
        lastTargetId: targetId,
        perTarget: { ...settings.perTarget, [targetId]: { distanceM, caliberMm } },
      });
      onStart({ targetId, distanceM, caliberMm, photo });
    } catch (e) {
      setError(`Could not read the image: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const valid = distanceM > 0 && caliberMm > 0;
  const isPreset = CALIBERS.some((c) => c.mm === caliberMm);

  return (
    <div className="page narrow">
      <h1>New group</h1>

      <section className="card">
        <h2>Target</h2>
        <div className="target-grid" role="radiogroup" aria-label="Target type">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === targetId}
              className={t.id === targetId ? 'target-option selected' : 'target-option'}
              onClick={() => pickTarget(t.id)}
            >
              <TargetIcon kind={t.kind} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Shooting</h2>
        <div className="form-row">
          <label>
            Distance (m)
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={distanceM}
              onChange={(e) => setDistanceM(parseFloat(e.target.value) || 0)}
            />
          </label>
          <label>
            Caliber
            <select
              value={isPreset ? String(caliberMm) : 'custom'}
              onChange={(e) => e.target.value !== 'custom' && setCaliberMm(parseFloat(e.target.value))}
            >
              {CALIBERS.map((c) => (
                <option key={c.label} value={c.mm}>
                  {c.label}
                </option>
              ))}
              <option value="custom">Other…</option>
            </select>
          </label>
          <label>
            Bullet Ø (mm)
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step={0.01}
              value={caliberMm}
              onChange={(e) => setCaliberMm(parseFloat(e.target.value) || 0)}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Photo</h2>
        <p className="hint">
          Shoot the target straight on, fill the frame and avoid hard shadows.
          {target.kind === 'ring' && ' The whole black aiming mark must be visible.'}
          {target.kind === 'grid' && ' Make sure a rectangle of grid lines around the group is visible.'}
        </p>
        <div className="button-row">
          <button type="button" className="primary" disabled={!valid || busy} onClick={() => cameraRef.current?.click()}>
            Take photo
          </button>
          <button type="button" disabled={!valid || busy} onClick={() => fileRef.current?.click()}>
            Choose image…
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <p className="status">Loading image…</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}

function TargetIcon({ kind }: { kind: string }) {
  if (kind === 'ring')
    return (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="7" fill="currentColor" />
      </svg>
    );
  if (kind === 'grid')
    return (
      <svg viewBox="0 0 40 40" aria-hidden="true">
        {[6, 13, 20, 27, 34].map((v) => (
          <g key={v}>
            <line x1={v} y1="4" x2={v} y2="36" stroke="currentColor" strokeWidth="1.2" />
            <line x1="4" y1={v} x2="36" y2={v} stroke="currentColor" strokeWidth="1.2" />
          </g>
        ))}
      </svg>
    );
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <line x1="6" y1="30" x2="34" y2="30" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6" y1="26" x2="6" y2="34" stroke="currentColor" strokeWidth="1.5" />
      <line x1="34" y1="26" x2="34" y2="34" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
      <circle cx="24" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}
