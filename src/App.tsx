import { useCallback, useEffect, useState } from 'react';
import { ImportScreen, type Setup } from './screens/ImportScreen';
import { CalibrateScreen } from './screens/CalibrateScreen';
import { AnalyzeScreen } from './screens/AnalyzeScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { loadSettings, saveSettings } from './storage/settings';
import { vision } from './vision/client';
import type { Settings, Work } from './model';

type Stage =
  | { screen: 'import' }
  | { screen: 'calibrate'; setup: Setup }
  | { screen: 'analyze'; work: Work }
  | { screen: 'history' };

export function App() {
  const [stage, setStage] = useState<Stage>({ screen: 'import' });
  const [settings, setSettingsState] = useState<Settings>(loadSettings);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);

  // Start loading OpenCV (~10 MB) right away so it's ready by the time a photo is chosen.
  useEffect(() => {
    vision.warmUp().catch(() => undefined);
  }, []);

  const nav = (s: Stage['screen']) =>
    s === 'history' ? setStage({ screen: 'history' }) : setStage({ screen: 'import' });

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => nav('import')}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Skjutapp</span>
        </button>
        <nav>
          <button
            type="button"
            className={stage.screen !== 'history' ? 'tab active' : 'tab'}
            onClick={() => nav('import')}
          >
            New
          </button>
          <button
            type="button"
            className={stage.screen === 'history' ? 'tab active' : 'tab'}
            onClick={() => nav('history')}
          >
            History
          </button>
        </nav>
      </header>
      <main>
        {stage.screen === 'import' && (
          <ImportScreen
            settings={settings}
            onSettings={setSettings}
            onStart={(setup) => setStage({ screen: 'calibrate', setup })}
          />
        )}
        {stage.screen === 'calibrate' && (
          <CalibrateScreen
            setup={stage.setup}
            settings={settings}
            onSettings={setSettings}
            onBack={() => setStage({ screen: 'import' })}
            onDone={(work) => setStage({ screen: 'analyze', work })}
          />
        )}
        {stage.screen === 'analyze' && (
          <AnalyzeScreen
            key={stage.work.sessionId ?? stage.work.createdAt}
            initial={stage.work}
            settings={settings}
            onSettings={setSettings}
            onNew={() => setStage({ screen: 'import' })}
          />
        )}
        {stage.screen === 'history' && <HistoryScreen onOpen={(work) => setStage({ screen: 'analyze', work })} />}
      </main>
    </div>
  );
}
