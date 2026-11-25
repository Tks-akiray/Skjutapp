import type { GroupStats } from '../analysis/stats';
import type { ScoreSummary } from '../analysis/scoring';
import { mmToMoa, mmToMrad, sightCorrection, type AngularUnit } from '../analysis/units';
import type { Settings } from '../model';

interface Props {
  stats: GroupStats;
  score: ScoreSummary | null;
  distanceM: number;
  settings: Settings;
  onSettings: (s: Settings) => void;
}

const CLICK_PRESETS: Record<AngularUnit, number[]> = {
  MOA: [0.125, 0.25, 0.5, 1],
  MRAD: [0.05, 0.1, 0.2],
};

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

export function StatsPanel({ stats, score, distanceM, settings, onSettings }: Props) {
  const { clickUnit, clickValue } = settings;
  const ang = (mm: number) => (
    <span className="ang">
      {f2(mmToMoa(mm, distanceM))} MOA · {f2(mmToMrad(mm, distanceM))} mrad
    </span>
  );

  const { x, y } = stats.center;
  const horiz = Math.abs(x) < 0.05 ? 'centered' : `${f1(Math.abs(x))} mm ${x > 0 ? 'right' : 'left'}`;
  const vert = Math.abs(y) < 0.05 ? 'centered' : `${f1(Math.abs(y))} mm ${y > 0 ? 'low' : 'high'}`;
  const corr = sightCorrection(stats.center, distanceM, clickUnit, clickValue);
  const clicks = (v: number) => Math.round(v);
  const nClicks = (v: number) => {
    const n = Math.abs(clicks(v));
    return `${n} click${n === 1 ? '' : 's'}`;
  };

  return (
    <div className="stats">
      {score && (
        <div className="score-box">
          <div className="score-main">
            <span className="score-total">{score.total}</span>
            <span className="score-sub">
              {f1(score.decimalTotal)} decimal · {score.xCount} × inner ten
            </span>
          </div>
          <div className="score-shots" aria-label="Score per shot">
            {score.shots.map((s, i) => (
              <span key={i} className={s.x ? 'chip x' : s.ring === 0 ? 'chip miss' : 'chip'} title={`Shot ${i + 1}: ${s.decimal.toFixed(1)}`}>
                {s.ring === 0 ? 'M' : s.ring}
                {s.x ? '*' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <dl className="stat-list">
        <dt>Shots</dt>
        <dd>{stats.count}</dd>

        <dt>Group size <small>(center-to-center)</small></dt>
        <dd>
          <strong>{f1(stats.extremeSpread)} mm</strong>
          {stats.count >= 2 && ang(stats.extremeSpread)}
        </dd>

        <dt>Outside-to-outside</dt>
        <dd>{stats.count >= 2 ? `${f1(stats.outsideToOutside)} mm` : '–'}</dd>

        <dt>Width × height</dt>
        <dd>
          {f1(stats.width)} × {f1(stats.height)} mm
        </dd>

        <dt>Mean radius</dt>
        <dd>
          <strong>{f1(stats.meanRadius)} mm</strong>
          {stats.count >= 2 && ang(stats.meanRadius)}
        </dd>

        <dt>Group center</dt>
        <dd>
          {stats.count ? (
            <>
              {horiz}, {vert}
              <span className="ang">{f1(stats.offsetDistance)} mm from aim</span>
            </>
          ) : (
            '–'
          )}
        </dd>
      </dl>

      <div className="correction">
        <div className="correction-head">
          <h3>Sight correction</h3>
          <div className="click-settings">
            <select
              aria-label="Click unit"
              value={clickUnit}
              onChange={(e) => {
                const unit = e.target.value as AngularUnit;
                onSettings({ ...settings, clickUnit: unit, clickValue: unit === 'MOA' ? 0.25 : 0.1 });
              }}
            >
              <option value="MOA">MOA</option>
              <option value="MRAD">MRAD</option>
            </select>
            <select
              aria-label="Click value"
              value={clickValue}
              onChange={(e) => onSettings({ ...settings, clickValue: parseFloat(e.target.value) })}
            >
              {CLICK_PRESETS[clickUnit].map((v) => (
                <option key={v} value={v}>
                  {v} {clickUnit === 'MOA' ? 'MOA' : 'mrad'}/click
                </option>
              ))}
            </select>
          </div>
        </div>
        {stats.count ? (
          <div className="correction-values">
            <span>
              {clicks(corr.elevationClicks) === 0 ? 'Elevation OK' : `${corr.elevationClicks > 0 ? '↑ Up' : '↓ Down'} ${nClicks(corr.elevationClicks)}`}
            </span>
            <span>
              {clicks(corr.windageClicks) === 0 ? 'Windage OK' : `${corr.windageClicks > 0 ? '→ Right' : '← Left'} ${nClicks(corr.windageClicks)}`}
            </span>
          </div>
        ) : (
          <p className="hint small">Add shots to get a correction.</p>
        )}
        <p className="hint small">Moves the group center onto the aim point at {distanceM} m.</p>
      </div>
    </div>
  );
}
