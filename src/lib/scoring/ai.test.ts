import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoreInput, Settings } from '../../types';
import { DEFAULT_SETTINGS } from '../settings';
import { preloadScorer, scoreAnswer, testScoringEngine } from './index';

const fetchMock = vi.fn();

const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

const ANSWER =
  'Last spring on my team project, one teammate kept missing deadlines and the rest of us were frustrated. ' +
  'I asked him for a quiet coffee and listened to what was going on, and it turned out he was working night shifts. ' +
  'I split the work so his tasks were smaller and we delivered the project two days early.';

const input = (text = ANSWER): ScoreInput => ({
  question: {
    id: 'q1',
    text: 'Tell me about a difficult teammate.',
    category: 'behavioral',
    competencies: ['teamwork'],
  },
  transcript: { text, segments: [], durationSec: 60, engine: 'test' },
  gaze: null,
  durationSec: 60,
  maxSeconds: 90,
});

const MODEL_JSON = JSON.stringify({
  aspects: {
    relevance: { rating: 2, comment: 'On topic.' },
    substance: { rating: 2, comment: 'Specific.' },
    judgement: { rating: 2, comment: 'Mature.' },
    impact: { rating: 1, comment: 'Clear result.' },
    clarity: { rating: 1, comment: 'Easy to follow.' },
  },
  points: [
    { kind: 'positive', quote: 'delivered the project two days early', comment: 'Concrete result.' },
    { kind: 'positive', quote: 'this quote was invented by the model', comment: 'Should be dropped.' },
  ],
  summary: 'A solid answer.',
  better_answer: 'Keep the coffee story.',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: String(url),
    init: init as RequestInit,
    body: JSON.parse(String((init as RequestInit).body)),
  };
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('scoreAnswer with Anthropic', () => {
  const s = settings({ scoring: 'anthropic', anthropicKey: '  sk-ant-test  ', anthropicModel: 'claude-x' });

  it('sends the documented request shape and builds a validated AI evaluation', async () => {
    fetchMock.mockResolvedValue(json({ content: [{ type: 'text', text: MODEL_JSON }] }));
    const ev = await scoreAnswer(input(), s);

    const { url, init, body } = lastCall();
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-test'); // trimmed
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['content-type']).toBe('application/json');
    expect(body.model).toBe('claude-x');
    expect(body.max_tokens).toBe(1800);
    expect(typeof body.system).toBe('string');
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining('teammate') }]);

    expect(ev.source).toBe('ai');
    expect(ev.model).toBe('anthropic:claude-x');
    expect(ev.warning).toBeUndefined();
    expect(ev.summary).toBe('A solid answer.');
    expect(ev.betterAnswer).toBe('Keep the coffee story.');
    // The invented quote is dropped, the real one is kept.
    expect(ev.points.map((p) => p.quote)).toEqual(['delivered the project two days early']);
    expect(ev.score).toBeGreaterThan(50);
    expect(ev.verdict).toBe('Very positive');
  });

  it('falls back to rules with a warning when the key is missing, without calling the network', async () => {
    const ev = await scoreAnswer(input(), settings({ scoring: 'anthropic', anthropicKey: '   ' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ev.source).toBe('rules');
    expect(ev.warning).toMatch(/AI scoring failed \(anthropic\): No Anthropic API key set/);
    expect(ev.warning).toMatch(/built-in rules score instead\.$/);
  });

  it('falls back with a readable warning on 401', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'bad key' } }, 401));
    const ev = await scoreAnswer(input(), s);
    expect(ev.source).toBe('rules');
    expect(ev.warning).toContain('Anthropic rejected the API key (401)');
    expect(ev.warning).toContain('bad key');
  });

  it('falls back when the model returns no JSON', async () => {
    fetchMock.mockResolvedValue(json({ content: [{ type: 'text', text: 'Sorry, no.' }] }));
    const ev = await scoreAnswer(input(), s);
    expect(ev.source).toBe('rules');
    expect(ev.warning).toContain('did not return valid JSON');
  });

  it('falls back when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const ev = await scoreAnswer(input(), s);
    expect(ev.source).toBe('rules');
    expect(ev.warning).toContain("Can't reach Anthropic");
  });
});

describe('scoreAnswer with OpenAI', () => {
  const s = settings({ scoring: 'openai', openaiKey: 'sk-test', openaiModel: 'gpt-x' });

  it('sends a bearer token and JSON response format', async () => {
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: MODEL_JSON } }] }));
    const ev = await scoreAnswer(input(), s);
    const { url, init, body } = lastCall();
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(body.model).toBe('gpt-x');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(ev.model).toBe('openai:gpt-x');
    expect(ev.source).toBe('ai');
  });

  it('maps 429 to a rate limit warning', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'quota' } }, 429));
    const ev = await scoreAnswer(input(), s);
    expect(ev.warning).toContain('OpenAI rate limit or no credit (429)');
  });

  it('falls back with a warning when no key is set', async () => {
    const ev = await scoreAnswer(input(), settings({ scoring: 'openai', openaiKey: '' }));
    expect(ev.warning).toContain('No OpenAI API key set');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('scoreAnswer with Ollama', () => {
  it('posts to /api/chat on the configured URL (trailing slashes removed), no auth header', async () => {
    fetchMock.mockResolvedValue(json({ message: { content: MODEL_JSON } }));
    const ev = await scoreAnswer(
      input(),
      settings({ scoring: 'ollama', ollamaUrl: 'http://box:11434//', ollamaModel: 'llama-x' }),
    );
    const { url, init, body } = lastCall();
    expect(url).toBe('http://box:11434/api/chat');
    expect(Object.keys(init.headers as object)).toEqual(['content-type']);
    expect(body).toMatchObject({ model: 'llama-x', stream: false, format: 'json' });
    expect(ev.model).toBe('ollama:llama-x');
  });

  it('uses the default URL when none is set and explains an unreachable server', async () => {
    fetchMock.mockRejectedValue(new TypeError('connection refused'));
    const ev = await scoreAnswer(input(), settings({ scoring: 'ollama', ollamaUrl: '  ' }));
    expect(lastCall().url).toBe('http://localhost:11434/api/chat');
    expect(ev.warning).toContain("Can't reach Ollama at http://localhost:11434");
  });

  it('reports a missing model on 404', async () => {
    fetchMock.mockResolvedValue(json({ error: 'model not found' }, 404));
    const ev = await scoreAnswer(input(), settings({ scoring: 'ollama' }));
    expect(ev.warning).toContain('could not find the model (404)');
  });
});

describe('scoreAnswer general behaviour', () => {
  it('does not use the network for the rules engine', async () => {
    const ev = await scoreAnswer(input(), settings({ scoring: 'rules' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ev.source).toBe('rules');
    expect(ev.warning).toBeUndefined();
  });

  it('does not send very short answers to the AI engine', async () => {
    const ev = await scoreAnswer(
      input('I would just talk to them.'),
      settings({ scoring: 'openai', openaiKey: 'k' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ev.source).toBe('rules');
  });

  it('adds a rule-based red flag the model missed and keeps the verdict negative', async () => {
    const text = ANSWER + ' Honestly I lied to my manager about the delay so nobody would find out.';
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: MODEL_JSON } }] }));
    const ev = await scoreAnswer(input(text), settings({ scoring: 'openai', openaiKey: 'k' }));
    expect(ev.source).toBe('ai');
    expect(ev.points[0].kind).toBe('red_flag');
    expect(ev.points[0].quote).toContain('lied to my manager');
    expect(['Negative', 'Very negative']).toContain(ev.verdict);
  });

  it('preloadScorer resolves immediately for non-local engines', async () => {
    await expect(preloadScorer(settings({ scoring: 'anthropic' }))).resolves.toBeUndefined();
  });
});

describe('testScoringEngine', () => {
  it('rules need no setup', async () => {
    expect(await testScoringEngine(settings({ scoring: 'rules' }))).toEqual({
      ok: true,
      message: 'Built in, nothing to set up',
    });
  });

  it('reports Connected when the provider answers {"ok":true}', async () => {
    fetchMock.mockResolvedValue(json({ content: [{ type: 'text', text: '```json\n{"ok": true}\n```' }] }));
    const r = await testScoringEngine(settings({ scoring: 'anthropic', anthropicKey: 'k' }));
    expect(r).toEqual({ ok: true, message: 'Connected' });
    expect(lastCall().body.max_tokens).toBe(50);
  });

  it('reports an unexpected reply', async () => {
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: '{"ok":false}' } }] }));
    const r = await testScoringEngine(settings({ scoring: 'openai', openaiKey: 'k' }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not understood/);
  });

  it('asks for a key when missing', async () => {
    const r = await testScoringEngine(settings({ scoring: 'anthropic', anthropicKey: '' }));
    expect(r).toEqual({ ok: false, message: 'Add an API key' });
  });

  it.each([
    [401, 'Invalid API key'],
    [403, 'Invalid API key'],
    [404, 'Model not found'],
    [429, 'Rate limited or out of credit'],
    [500, 'OpenAI error (500)'],
  ])('maps HTTP %i to "%s"', async (status, message) => {
    fetchMock.mockResolvedValue(json({ error: { message: 'x' } }, status));
    const r = await testScoringEngine(settings({ scoring: 'openai', openaiKey: 'k' }));
    expect(r).toEqual({ ok: false, message });
  });

  it('reports an unreachable server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await testScoringEngine(settings({ scoring: 'ollama', ollamaUrl: 'http://x:1' }));
    expect(r).toEqual({ ok: false, message: "Can't reach Ollama at http://x:1" });
  });

  it('reports a timeout when the request is aborted', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
          }),
      );
      const p = testScoringEngine(settings({ scoring: 'openai', openaiKey: 'k' }));
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await p).toEqual({ ok: false, message: 'Timed out' });
    } finally {
      vi.useRealTimers();
    }
  });
});
