import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { testTranscription } from './index';

const fetchMock = vi.fn();
const openai = { ...DEFAULT_SETTINGS, transcription: 'openai' as const, openaiKey: ' sk-test ' };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('testTranscription (openai)', () => {
  it('asks for a key without calling the network', async () => {
    const r = await testTranscription({ ...openai, openaiKey: '  ' });
    expect(r).toEqual({ ok: false, message: 'Enter an API key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is Connected on 200 and sends the trimmed key', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await testTranscription(openai)).toEqual({ ok: true, message: 'Connected' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' });
  });

  it('maps 401 to Invalid API key', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    expect(await testTranscription(openai)).toEqual({ ok: false, message: 'Invalid API key' });
  });

  it('reports other HTTP errors with the status', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    expect(await testTranscription(openai)).toEqual({ ok: false, message: 'OpenAI error (503)' });
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await testTranscription(openai)).toEqual({ ok: false, message: "Can't reach OpenAI" });
  });
});
