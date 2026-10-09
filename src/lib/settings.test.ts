import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, LOCAL_MODEL, answerLimitSeconds, loadSettings, saveSettings } from './settings';

const KEY = 'ivp.settings.v1';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

describe('settings', () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns a copy, not the shared defaults object', () => {
    const before = DEFAULT_SETTINGS.answerSeconds;
    const s = loadSettings();
    s.answerSeconds = before + 1;
    expect(DEFAULT_SETTINGS.answerSeconds).toBe(before);
  });

  it('merges stored partial settings over defaults', () => {
    stubStorage({ [KEY]: JSON.stringify({ answerSeconds: 120, scoring: 'ollama' }) });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, answerSeconds: 120, scoring: 'ollama' });
  });

  it('falls back to defaults on corrupted JSON', () => {
    stubStorage({ [KEY]: '{not json' });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings', () => {
    saveSettings({ ...DEFAULT_SETTINGS, maxAttempts: 5, enableGaze: false });
    expect(loadSettings()).toMatchObject({ maxAttempts: 5, enableGaze: false });
  });

  it('does not throw when saving fails', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('migrates the old "heuristic" scorer to "rules"', () => {
    stubStorage({ [KEY]: JSON.stringify({ scoring: 'heuristic', onboarded: true }) });
    expect(loadSettings()).toMatchObject({ scoring: 'rules', onboarded: true });
  });

  it('moves people off retired local models onto the current one', () => {
    stubStorage({ [KEY]: JSON.stringify({ localModel: 'onnx-community/Qwen2.5-1.5B-Instruct' }) });
    expect(loadSettings().localModel).toBe(LOCAL_MODEL);
    stubStorage({ [KEY]: JSON.stringify({ localModel: 'my-org/custom-model' }) });
    expect(loadSettings().localModel).toBe('my-org/custom-model');
  });

  it('keeps unknown stored keys and ignores a non-object payload gracefully', () => {
    stubStorage({ [KEY]: JSON.stringify('just a string') });
    expect(loadSettings().scoring).toBe(DEFAULT_SETTINGS.scoring);
    stubStorage({ [KEY]: 'null' });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to a fresh, not yet onboarded install', () => {
    expect(DEFAULT_SETTINGS.onboarded).toBe(false);
    expect(DEFAULT_SETTINGS.maxAttempts).toBe(3);
  });

  it('clamps the answer limit to 60-120 seconds', () => {
    expect(answerLimitSeconds({ ...DEFAULT_SETTINGS, answerSeconds: 5 })).toBe(60);
    expect(answerLimitSeconds({ ...DEFAULT_SETTINGS, answerSeconds: 90 })).toBe(90);
    expect(answerLimitSeconds({ ...DEFAULT_SETTINGS, answerSeconds: 999 })).toBe(120);
  });
});
