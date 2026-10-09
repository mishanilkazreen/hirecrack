/// <reference lib="webworker" />
// Runs Whisper (transformers.js) off the main thread so the UI stays responsive.
import { pipeline, env } from '@huggingface/transformers';

export type WorkerRequest =
  | { type: 'load'; id: number; model: string }
  | { type: 'transcribe'; id: number; model: string; audio: Float32Array };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; progress?: number }
  | { type: 'loaded'; id: number; device: string }
  | { type: 'result'; id: number; text: string; chunks: { start: number; end: number; text: string }[] }
  | { type: 'error'; id: number; message: string };

env.allowLocalModels = false;
env.useBrowserCache = true;

// transformers.js pipelines are loosely typed, so keep this opaque.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Asr = any;
let asr: Asr | null = null;
let loadedModel = '';
let loadedDevice = '';
let loading: Promise<void> | null = null;

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

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

async function build(model: string, device: 'webgpu' | 'wasm', id: number): Promise<Asr> {
  const onProgress = makeProgress(id);
  // 4-bit decoder on WebGPU, 8-bit on wasm.
  const dtype = { encoder_model: 'fp32', decoder_model_merged: device === 'webgpu' ? 'q4' : 'q8' };
  const pipe = await (pipeline as Asr)('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: onProgress,
  });
  // Warm-up on one second of silence so the first real transcription is not slow.
  try {
    await pipe(new Float32Array(16000));
  } catch (e) {
    if (device === 'webgpu') throw e;
  }
  return pipe;
}

async function disposeQuietly() {
  try {
    await asr?.dispose?.();
  } catch {
    // Already broken or already gone; nothing to do.
  }
}

async function ensure(model: string, id: number): Promise<void> {
  if (loading) await loading.catch(() => undefined);
  if (asr && loadedModel === model) return;
  loading = (async () => {
    await disposeQuietly();
    asr = null;
    post({ type: 'progress', id, stage: 'Loading model' });
    let device: 'webgpu' | 'wasm' = 'wasm';
    let pipe: Asr | null = null;
    if ((self.navigator as Navigator & { gpu?: unknown }).gpu) {
      try {
        pipe = await build(model, 'webgpu', id);
        device = 'webgpu';
      } catch (e) {
        console.warn('WebGPU whisper init failed, falling back to wasm', e);
      }
    }
    if (!pipe) pipe = await build(model, 'wasm', id);
    asr = pipe;
    loadedModel = model;
    loadedDevice = device;
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    await ensure(msg.model, msg.id);
    if (msg.type === 'load') {
      post({ type: 'loaded', id: msg.id, device: loadedDevice });
      return;
    }
    post({ type: 'progress', id: msg.id, stage: 'Transcribing' });
    const run = (a: Asr) => a(msg.audio, { return_timestamps: true, chunk_length_s: 30 });
    let out;
    try {
      out = await run(asr);
    } catch (e) {
      if (loadedDevice !== 'webgpu') throw e;
      // GPU inference failed, so rebuild on wasm and retry once.
      console.warn('WebGPU whisper inference failed, retrying on wasm', e);
      await disposeQuietly();
      asr = await build(msg.model, 'wasm', msg.id);
      loadedDevice = 'wasm';
      out = await run(asr);
    }
    const o = Array.isArray(out) ? out[0] : out;
    const chunks = ((o.chunks ?? []) as { text: string; timestamp: [number, number | null] }[]).map((c) => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
      text: c.text,
    }));
    post({ type: 'result', id: msg.id, text: String(o.text ?? ''), chunks });
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
};
