import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttemptResult } from '../types';

const clearVideos = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('./videoStore', () => ({ clearVideos }));

import { clearHistory, loadHistory, saveResult } from './history';

const KEY = 'ivp.history.v2';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

function result(id: string, score = 10): AttemptResult {
  return {
    id,
    question: { id: 'q', text: 'Q?', category: 'behavioral', competencies: [] },
    createdAt: 1,
    attemptsUsed: 1,
    durationSec: 30,
    transcript: { text: 't', segments: [], durationSec: 30, engine: 'test' },
    evaluation: {
      score,
      verdict: 'Neutral',
      summary: '',
      aspects: [],
      points: [],
      delivery: {
        wordCount: 1,
        wpm: 1,
        fillerCount: 0,
        fillerRatePerMin: 0,
        fillersFound: {},
        timeUsedPct: 0,
        longPauses: 0,
      },
      presence: null,
      source: 'rules',
    },
  };
}

describe('history', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearVideos.mockClear();
  });

  it('is empty when nothing is stored', () => {
    stubStorage();
    expect(loadHistory()).toEqual([]);
  });

  it('stores under the v2 key, newest first', () => {
    const store = stubStorage();
    saveResult(result('a'));
    saveResult(result('b'));
    expect(store.has(KEY)).toBe(true);
    expect(loadHistory().map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('replaces an entry with the same id instead of duplicating it', () => {
    stubStorage();
    saveResult(result('a', 1));
    saveResult(result('b'));
    saveResult(result('a', 99));
    const list = loadHistory();
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(list[0].evaluation.score).toBe(99);
  });

  it('drops entries that do not have the current evaluation shape', () => {
    const old = { id: 'old', evaluation: { total: 80, strengths: [] } };
    stubStorage({ [KEY]: JSON.stringify([old, result('ok'), null, 'junk', { id: 'x' }]) });
    expect(loadHistory().map((r) => r.id)).toEqual(['ok']);
  });

  it('returns an empty list for corrupt or non-array storage', () => {
    stubStorage({ [KEY]: '{oops' });
    expect(loadHistory()).toEqual([]);
    stubStorage({ [KEY]: JSON.stringify({ not: 'an array' }) });
    expect(loadHistory()).toEqual([]);
  });

  it('keeps only the newest 50 results', () => {
    stubStorage();
    for (let i = 0; i < 55; i++) saveResult(result(`r${i}`));
    const list = loadHistory();
    expect(list).toHaveLength(50);
    expect(list[0].id).toBe('r54');
    expect(list[49].id).toBe('r5');
  });

  it('does not throw when storage is full or blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => saveResult(result('a'))).not.toThrow();
    expect(() => clearHistory()).not.toThrow();
  });

  it('clearHistory removes the list and also clears stored videos', () => {
    const store = stubStorage();
    saveResult(result('a'));
    clearHistory();
    expect(store.has(KEY)).toBe(false);
    expect(loadHistory()).toEqual([]);
    expect(clearVideos).toHaveBeenCalledTimes(1);
  });
});
