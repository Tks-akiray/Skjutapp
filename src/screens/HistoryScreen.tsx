import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendChart, type TrendPoint } from '../components/TrendChart';
import { deleteSession, exportSessions, getSession, importSessions, listSessions } from '../storage/db';
import { TARGETS, getTarget } from '../targets/definitions';
import { mmToMoa } from '../analysis/units';
import { decodeBlob } from '../imageUtils';
import type { StoredSession, Work } from '../model';

interface Props {
  onOpen: (work: Work) => void;
}

type Metric = 'esMoa' | 'mrMoa' | 'esMm' | 'scorePerShot';

const METRICS: { id: Metric; label: string; ringOnly?: boolean }[] = [
  { id: 'esMoa', label: 'Group size (MOA)' },
  { id: 'mrMoa', label: 'Mean radius (MOA)' },
  { id: 'esMm', label: 'Group size (mm)' },
  { id: 'scorePerShot', label: 'Average score per shot', ringOnly: true },
];

function metricValue(s: StoredSession, m: Metric): number | null {
  const { summary: sum, distanceM } = s;
  if (m === 'scorePerShot') return sum.score !== undefined && sum.count ? sum.score / sum.count : null;
  if (sum.count < 2) return null;
  if (m === 'esMoa') return mmToMoa(sum.extremeSpreadMm, distanceM);
  if (m === 'mrMoa') return mmToMoa(sum.meanRadiusMm, distanceM);
  return sum.extremeSpreadMm;
}

function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img className="thumb" src={url} alt="" /> : <div className="thumb" />;
}

export function HistoryScreen({ onOpen }: Props) {
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);
  const [targetFilter, setTargetFilter] = useState<string>('all');
  const [metric, setMetric] = useState<Metric>('esMoa');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const reload = () =>
    listSessions()
      .then(setSessions)
      .catch((e) => setError(`Could not read history: ${e}`));

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(
    () => (sessions ?? []).filter((s) => targetFilter === 'all' || s.targetId === targetFilter),
    [sessions, targetFilter],
  );

  const metricDef = METRICS.find((m) => m.id === metric)!;
  const trend: TrendPoint[] = useMemo(
    () =>
      [...filtered]
        .reverse()
        .map((s) => ({ s, v: metricValue(s, metric) }))
        .filter((o): o is { s: StoredSession; v: number } => o.v !== null)
        .map(({ s, v }) => ({
          t: s.createdAt,
          value: v,
          detail: `${getTarget(s.targetId).name} · ${s.distanceM} m · ${s.summary.count} shots`,
        })),
    [filtered, metric],
  );
  const fmt = (v: number) => (metric === 'esMm' ? `${v.toFixed(0)} mm` : metric === 'scorePerShot' ? v.toFixed(1) : v.toFixed(2));

  const open = async (id: string) => {
    const s = await getSession(id);
    if (!s) return;
    const image = await decodeBlob(s.image);
    onOpen({
      sessionId: s.id,
      createdAt: s.createdAt,
      targetId: s.targetId,
      distanceM: s.distanceM,
      caliberMm: s.caliberMm,
      notes: s.notes,
      calib: { image, pxPerMm: s.pxPerMm, aimPx: s.aimPx },
      shots: s.shots,
    });
  };

  const remove = async (s: StoredSession) => {
    if (!confirm(`Delete the session from ${new Date(s.createdAt).toLocaleString()}? This cannot be undone.`)) return;
    await deleteSession(s.id);
    reload();
  };

  const doExport = async () => {
    setError(null);
    try {
      const blob = await exportSessions();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `skjutapp-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const n = await importSessions(file);
      setMessage(`Imported ${n} session${n === 1 ? '' : 's'}.`);
      reload();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>History</h1>
        <div className="button-row">
          <button type="button" onClick={doExport} disabled={!sessions?.length}>
            Export
          </button>
          <button type="button" onClick={() => importRef.current?.click()}>
            Import…
          </button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
        </div>
      </div>
      {message && <p className="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      {sessions === null ? (
        <p className="status">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="card empty">
          <p>No saved sessions yet. Analyze a group and press <strong>Save session</strong>.</p>
        </div>
      ) : (
        <>
          <div className="filters">
            <label>
              Target
              <select value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
                <option value="all">All targets</option>
                {TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Metric
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                {METRICS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="card">
            <h2>{metricDef.label}</h2>
            {trend.length >= 1 ? (
              <TrendChart points={trend} format={fmt} label={`${metricDef.label} over ${trend.length} sessions`} />
            ) : (
              <p className="hint">
                {metricDef.ringOnly ? 'No scored ring-target sessions in this selection.' : 'Need sessions with at least 2 shots.'}
              </p>
            )}
          </section>

          <ul className="session-list">
            {filtered.map((s) => {
              const t = getTarget(s.targetId);
              const sum = s.summary;
              return (
                <li key={s.id} className="session">
                  <button type="button" className="session-open" onClick={() => open(s.id)}>
                    <Thumb blob={s.thumb} />
                    <div className="session-info">
                      <strong>{new Date(s.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                      <span>
                        {t.name} · {s.distanceM} m · {sum.count} shots
                      </span>
                      <span>
                        {sum.count >= 2
                          ? `${sum.extremeSpreadMm.toFixed(1)} mm (${mmToMoa(sum.extremeSpreadMm, s.distanceM).toFixed(2)} MOA)`
                          : '–'}
                        {sum.score !== undefined && ` · ${sum.score} pts${sum.xCount ? ` (${sum.xCount} X)` : ''}`}
                      </span>
                      {s.notes && <span className="notes-preview">{s.notes}</span>}
                    </div>
                  </button>
                  <button type="button" className="icon-btn" aria-label="Delete session" onClick={() => remove(s)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
