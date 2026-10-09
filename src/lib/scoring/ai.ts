// AI engines: anthropic, openai, ollama (HTTP) and local (in-app LLM worker).
import type { EngineTestResult, Evaluation, ProgressInfo, ScoreInput, Settings } from '../../types';
import { generateLocal, loadLocalModel } from './llm';
import { buildAiEvaluation, extractJson } from './parse';
import { LOCAL_PREFILL, TEST_PROMPT, buildPrompt, type Prompt } from './prompt';

type OnProgress = (p: ProgressInfo) => void;

const SCORE_TIMEOUT_MS = 120_000;
export const TEST_TIMEOUT_MS = 20_000;

/** An error with a short message suitable for showing next to the Test button. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly short: string = message,
  ) {
    super(message);
  }
}

export function engineModel(settings: Settings): string {
  switch (settings.scoring) {
    case 'anthropic':
      return `anthropic:${settings.anthropicModel}`;
    case 'openai':
      return `openai:${settings.openaiModel}`;
    case 'ollama':
      return `ollama:${settings.ollamaModel}`;
    case 'local':
      return `local:${settings.localModel}`;
    default:
      return 'rules';
  }
}

async function readError(resp: Response): Promise<string> {
  try {
    const body = await resp.json();
    return String(body?.error?.message ?? body?.error ?? body?.message ?? resp.statusText);
  } catch {
    return resp.statusText;
  }
}

function httpError(provider: string, status: number, detail: string): EngineError {
  if (status === 401 || status === 403)
    return new EngineError(`${provider} rejected the API key (${status}). ${detail}`, 'Invalid API key');
  if (status === 404)
    return new EngineError(`${provider} could not find the model (404). ${detail}`, 'Model not found');
  if (status === 429)
    return new EngineError(
      `${provider} rate limit or no credit (429). ${detail}`,
      'Rate limited or out of credit',
    );
  return new EngineError(`${provider} returned ${status}. ${detail}`, `${provider} error (${status})`);
}

async function post(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  unreachable: string,
): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw new EngineError('The request timed out', 'Timed out');
    throw new EngineError(`${unreachable}: ${e instanceof Error ? e.message : String(e)}`, unreachable);
  }
  if (!resp.ok) throw httpError(provider, resp.status, await readError(resp));
  return resp.json();
}

async function callHttp(
  settings: Settings,
  prompt: Prompt,
  signal: AbortSignal,
  maxTokens: number,
): Promise<string> {
  switch (settings.scoring) {
    case 'anthropic': {
      if (!settings.anthropicKey.trim()) throw new EngineError('No Anthropic API key set', 'Add an API key');
      const j = (await post(
        'Anthropic',
        'https://api.anthropic.com/v1/messages',
        {
          'x-api-key': settings.anthropicKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        {
          model: settings.anthropicModel,
          max_tokens: maxTokens,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        },
        signal,
        "Can't reach Anthropic",
      )) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
    }
    case 'openai': {
      if (!settings.openaiKey.trim()) throw new EngineError('No OpenAI API key set', 'Add an API key');
      const j = (await post(
        'OpenAI',
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${settings.openaiKey.trim()}` },
        {
          model: settings.openaiModel,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        },
        signal,
        "Can't reach OpenAI",
      )) as { choices?: { message?: { content?: string } }[] };
      return j.choices?.[0]?.message?.content ?? '';
    }
    case 'ollama': {
      const base = settings.ollamaUrl.trim().replace(/\/+$/, '') || 'http://localhost:11434';
      const j = (await post(
        'Ollama',
        `${base}/api/chat`,
        {},
        {
          model: settings.ollamaModel,
          stream: false,
          format: 'json',
          options: { temperature: 0.2, num_ctx: 4096 },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        },
        signal,
        `Can't reach Ollama at ${base}`,
      )) as { message?: { content?: string } };
      return j.message?.content ?? '';
    }
    default:
      throw new EngineError(`Unsupported engine: ${settings.scoring}`);
  }
}

/** Runs the configured AI engine on an answer. Throws on any failure; the caller falls back. */
export async function aiScore(
  input: ScoreInput,
  settings: Settings,
  rules: Evaluation,
  onProgress?: OnProgress,
): Promise<Evaluation> {
  const model = engineModel(settings);
  const build = (json: unknown) => buildAiEvaluation(json, { input, delivery: rules.delivery, rules, model });
  let ev: Evaluation;
  if (settings.scoring === 'local') {
    onProgress?.({ stage: 'Loading model' });
    const full = buildPrompt(input, { compact: true });
    const raw = await generateLocal(settings.localModel, full.system, full.user, onProgress, {
      prefill: LOCAL_PREFILL,
    });
    try {
      ev = build(extractJson(raw));
    } catch {
      // One retry with a much shorter "ratings only" reply, merged with the rules feedback.
      onProgress?.({ stage: 'Scoring' });
      const lean = buildPrompt(input, { compact: true, ratingsOnly: true });
      const raw2 = await generateLocal(settings.localModel, lean.system, lean.user, onProgress, {
        prefill: LOCAL_PREFILL,
        maxNewTokens: 300,
      });
      try {
        ev = build(extractJson(raw2));
      } catch {
        throw new Error('The local model gave a reply that could not be read');
      }
    }
  } else {
    const prompt = buildPrompt(input);
    onProgress?.({ stage: 'Scoring' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SCORE_TIMEOUT_MS);
    let raw: string;
    try {
      raw = await callHttp(settings, prompt, ctl.signal, 1800);
    } finally {
      clearTimeout(timer);
    }
    ev = build(extractJson(raw));
  }
  onProgress?.({ stage: 'Scoring', progress: 1 });
  return ev;
}

export async function preloadLocal(settings: Settings, onProgress?: OnProgress): Promise<void> {
  await loadLocalModel(settings.localModel, onProgress);
}

export async function testEngine(settings: Settings): Promise<EngineTestResult> {
  if (settings.scoring === 'rules') return { ok: true, message: 'Built in, nothing to set up' };
  try {
    if (settings.scoring === 'local') {
      await loadLocalModel(settings.localModel);
      return { ok: true, message: 'Downloaded and ready' };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TEST_TIMEOUT_MS);
    try {
      const out = await callHttp(settings, TEST_PROMPT, ctl.signal, 50);
      const json = extractJson(out) as { ok?: unknown } | null;
      if (json && json.ok === true) return { ok: true, message: 'Connected' };
      return { ok: false, message: 'Connected, but the reply was not understood' };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, message: e.short };
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: m.length > 80 ? m.slice(0, 77) + '...' : m };
  }
}
