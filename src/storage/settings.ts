import type { Settings } from '../model';

const KEY = 'skjutapp.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  clickUnit: 'MOA',
  clickValue: 0.25,
  sensitivity: 0.5,
  lastTargetId: 'issf-pistol-precision',
  perTarget: {},
  grid: { squareMm: 10 },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, grid: { squareMm: parsed.grid?.squareMm ?? DEFAULT_SETTINGS.grid.squareMm } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}
