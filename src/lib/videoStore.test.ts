import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVideos, loadVideo, saveVideo } from './videoStore';

const blob = (text: string) => new Blob([text], { type: 'video/webm' });

describe('videoStore', () => {
  beforeEach(() => {
    // A fresh database for every test.
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('saves and loads a recording by id', async () => {
    await saveVideo('a', blob('hello'));
    const out = await loadVideo('a');
    expect(out).not.toBeNull();
    expect(out!.size).toBe(5);
    expect(out!.type).toBe('video/webm');
  });

  it('returns null for an unknown id', async () => {
    expect(await loadVideo('missing')).toBeNull();
  });

  it('overwrites a recording saved under the same id', async () => {
    await saveVideo('a', blob('one'));
    await saveVideo('a', blob('three'));
    expect((await loadVideo('a'))!.size).toBe(5);
  });

  it('keeps only the newest 20 recordings', async () => {
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i < 23; i++) {
      now.mockReturnValue(1_000 + i * 10);
      await saveVideo(`v${i}`, blob(`x${i}`));
    }
    now.mockRestore();
    for (let i = 0; i < 3; i++) expect(await loadVideo(`v${i}`), `v${i} should be gone`).toBeNull();
    for (let i = 3; i < 23; i++) expect(await loadVideo(`v${i}`), `v${i} should be kept`).not.toBeNull();
  });

  it('clearVideos removes everything', async () => {
    await saveVideo('a', blob('a'));
    await saveVideo('b', blob('b'));
    await clearVideos();
    expect(await loadVideo('a')).toBeNull();
    expect(await loadVideo('b')).toBeNull();
  });

  it('degrades quietly when IndexedDB is not available', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveVideo('a', blob('a'))).resolves.toBeUndefined();
    await expect(loadVideo('a')).resolves.toBeNull();
    await expect(clearVideos()).resolves.toBeUndefined();
  });

  it('degrades quietly when opening the database throws', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('denied');
      },
    });
    await expect(saveVideo('a', blob('a'))).resolves.toBeUndefined();
    await expect(loadVideo('a')).resolves.toBeNull();
  });
});
