/// <reference lib="webworker" />
// Runs the small in-app scoring LLM (transformers.js) off the main thread.
import { InterruptableStoppingCriteria, pipeline, env, TextStreamer } from '@huggingface/transformers';
import { jsonCloseTracker } from './jsonStream';
import { isDegenerate } from './degenerate';

export type WorkerRequest =
  | { type: 'load'; id: number; model: string }
  | {
      type: 'generate';
      id: number;
      model: string;
      system: string;
      user: string;
      maxNewTokens: number;
      prefill?: string;
    };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; progress?: number }
  | { type: 'loaded'; id: number; device: string }
  | { type: 'result'; id: number; text: string; device: string; ms: number }
  | { type: 'error'; id: number; message: string };

env.allowLocalModels = false;
env.useBrowserCache = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gen = any;
let gen: Gen | null = null;
let loadedModel = '';
let loadedDevice = '';
let loading: Promise<void> | null = null;

const NO_GPU = 'Local AI needs a graphics card with WebGPU support';
const GPU_BROKEN = 'Your graphics card gave unusable output for Local AI';

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

async function gpuAdapter(): Promise<{ features: ReadonlySet<string> } | null> {
  try {
    const gpu = (
      self.navigator as Navigator & {
        gpu?: { requestAdapter(): Promise<{ features: ReadonlySet<string> } | null> };
      }
    ).gpu;
    return (await gpu?.requestAdapter()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Turns transformers.js file events into two stages: "Downloading" (0-99%, only when bytes are
 * actually fetched) and "Loading model" (indeterminate) once every file is in hand.
 */
function makeProgress(id: number) {
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  let last = 0;
  let downloading = false;
  let stage = '';
  const emit = (s: string, progress?: number) => {
    if (s === stage && progress === undefined) return;
    stage = s;
    post({ type: 'progress', id, stage: s, progress });
  };
  return (p: Record<string, unknown>) => {
    const file = typeof p.file === 'string' ? p.file : null;
    if (p.status === 'initiate' && file) {
      if (!files.has(file)) files.set(file, { loaded: 0, total: 0, done: false });
    } else if ((p.status === 'download' || p.status === 'progress') && file) {
      const f = files.get(file) ?? { loaded: 0, total: 0, done: false };
      if (p.status === 'progress') {
        f.loaded = Number(p.loaded) || 0;
        f.total = Number(p.total) || f.total;
      }
      files.set(file, f);
      downloading = true;
    } else if (p.status === 'done' && file) {
      const f = files.get(file) ?? { loaded: 0, total: 0, done: false };
      f.done = true;
      if (f.total > 0) f.loaded = f.total;
      files.set(file, f);
    } else {
      return;
    }
    if (!downloading) return;
    const all = [...files.values()];
    if (all.every((f) => f.done)) {
      emit('Loading model');
      return;
    }
    let l = 0;
    let t = 0;
    for (const f of all) {
      l += f.loaded;
      t += f.total;
    }
    // Files whose size is not known yet are still in the denominator's blind spot, so never reach 100%.
    const frac = Math.min(0.99, Math.max(last, t > 0 ? l / t : 0));
    last = frac;
    stage = 'Downloading';
    post({ type: 'progress', id, stage: 'Downloading', progress: frac });
  };
}

async function build(model: string, id: number): Promise<Gen> {
  const pipe = await (pipeline as Gen)('text-generation', model, {
    device: 'webgpu',
    dtype: 'q4f16',
    progress_callback: makeProgress(id),
  });
  // Warm-up: compiles the GPU kernels now so the first real score is not slow, and checks the
  // output is real text (some GPUs overflow in fp16 and only produce "!!!!").
  const out = await pipe('The capital of France is', {
    max_new_tokens: 8,
    do_sample: false,
    return_full_text: false,
  });
  const text = String((Array.isArray(out) ? out[0] : out)?.generated_text ?? '');
  if (isDegenerate(text)) throw new Error(GPU_BROKEN);
  return pipe;
}

async function disposeQuietly() {
  try {
    await gen?.dispose?.();
  } catch {
    // already gone
  }
}

async function ensure(model: string, id: number): Promise<void> {
  if (loading) await loading.catch(() => undefined);
  if (gen && loadedModel === model) return;
  loading = (async () => {
    await disposeQuietly();
    gen = null;
    post({ type: 'progress', id, stage: 'Loading model' });
    // The scoring model only ships in fp16, which needs WebGPU; on the CPU it would not fit or run.
    // navigator.gpu can exist with no usable adapter, so ask for one.
    if (!(await gpuAdapter())) throw new Error(NO_GPU);
    gen = await build(model, id);
    loadedModel = model;
    loadedDevice = 'webgpu';
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

async function run(msg: Extract<WorkerRequest, { type: 'generate' }>): Promise<string> {
  const messages = [
    { role: 'system', content: msg.system },
    { role: 'user', content: msg.user },
  ];
  // Render the chat template ourselves so thinking can be switched off for Qwen3-style models.
  let prompt: string = gen.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
    enable_thinking: false,
  });
  prompt += msg.prefill ?? '';
  let n = 0;
  // Stop as soon as the JSON object closes; the model otherwise keeps writing notes after it.
  const stopper = new InterruptableStoppingCriteria();
  const closes = jsonCloseTracker(msg.prefill ?? '');
  const streamer = new TextStreamer(gen.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (closes(chunk)) stopper.interrupt();
      n++;
      // Rough progress: a typical reply is about 600 tokens.
      post({ type: 'progress', id: msg.id, stage: 'Scoring', progress: Math.min(0.95, n / 600) });
    },
  });
  const out = await gen(prompt, {
    max_new_tokens: msg.maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.05,
    return_full_text: false,
    streamer,
    stopping_criteria: stopper,
  });
  const o = Array.isArray(out) ? out[0] : out;
  const g = o?.generated_text;
  if (typeof g === 'string') return g;
  if (Array.isArray(g)) return String(g[g.length - 1]?.content ?? '');
  return '';
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    await ensure(msg.model, msg.id);
    if (msg.type === 'load') {
      post({ type: 'loaded', id: msg.id, device: loadedDevice });
      return;
    }
    post({ type: 'progress', id: msg.id, stage: 'Scoring', progress: 0 });
    const t0 = Date.now();
    const text = await run(msg);
    if (isDegenerate(text)) throw new Error(GPU_BROKEN);
    post({ type: 'result', id: msg.id, text, device: loadedDevice, ms: Date.now() - t0 });
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
};
