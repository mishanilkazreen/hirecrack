import type { EngineTestResult, ProgressInfo, Settings, Transcript, TranscriptSegment } from '../../types';
import type { WorkerRequest, WorkerResponse } from './whisper.worker';

// Whisper models expect 16 kHz mono audio.
const SAMPLE_RATE = 16000;
// Recordings quieter than this are treated as silence; Whisper tends to invent text for them.
const SILENCE_RMS = 0.003;

type OnProgress = (p: ProgressInfo) => void;

async function decodeTo16kMono(media: Blob): Promise<Float32Array> {
  const buf = await media.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: SAMPLE_RATE });
    try {
      decoded = await ctx.decodeAudioData(buf.slice(0));
    } finally {
      void ctx.close().catch(() => undefined);
    }
  } catch (e) {
    const why = e instanceof Error && e.message ? `: ${e.message}` : '.';
    throw new Error(
      `Could not decode the recorded audio (${media.type || 'unknown type'}, ${media.size} bytes). ` +
        `The browser could not read the audio track of this recording${why}`,
      { cause: e },
    );
  }
  // Some browsers ignore the requested sample rate, so resample if needed.
  if (decoded.sampleRate !== SAMPLE_RATE) {
    const len = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const off = new OfflineAudioContext(decoded.numberOfChannels, len, SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    decoded = await off.startRendering();
  }
  const n = decoded.length;
  const mono = new Float32Array(n);
  const ch = decoded.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
  }
  return mono;
}

function rms(a: Float32Array): number {
  if (!a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}

// Whisper often emits these for silence or background noise.
const HALLUCINATIONS = new Set([
  '[blank_audio]',
  '[blank audio]',
  '(silence)',
  '[silence]',
  '[ silence ]',
  '(blank audio)',
  '[music]',
  '(music)',
  '[inaudible]',
  '(inaudible)',
  'thank you.',
  'thank you',
  'thanks for watching.',
  'thanks for watching',
  'you',
  'bye.',
  '.',
]);

function isHallucination(t: string): boolean {
  const s = t.trim().toLowerCase();
  return s === '' || HALLUCINATIONS.has(s) || /^[[(][^\])]*[\])]$/.test(s);
}

function empty(durationSec: number, engine: string): Transcript {
  return { text: '', segments: [], durationSec, engine };
}

function finish(text: string, segs: TranscriptSegment[], durationSec: number, engine: string): Transcript {
  const cleaned = segs
    .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
    .filter((s) => s.text && !isHallucination(s.text));
  const full = text.trim();
  if (isHallucination(full) || (!cleaned.length && segs.length)) return empty(durationSec, engine);
  const finalText =
    cleaned.length && cleaned.length !== segs.length ? cleaned.map((s) => s.text).join(' ') : full;
  return { text: finalText.replace(/\s+/g, ' ').trim(), segments: cleaned, durationSec, engine };
}

// The local model lives in one shared worker; requests are matched to replies by id.
type Req = { type: 'load'; model: string } | { type: 'transcribe'; model: string; audio: Float32Array };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve: (m: WorkerResponse) => void;
    reject: (e: Error) => void;
    onProgress?: OnProgress;
  }
>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') {
      p.onProgress?.({ stage: m.stage, progress: m.progress });
      return;
    }
    pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message));
    else p.resolve(m);
  };
  const fail = (msg: string) => {
    pending.forEach((p) => p.reject(new Error(msg)));
    pending.clear();
    w.terminate();
    if (worker === w) worker = null;
  };
  w.onerror = (e) => fail(`Speech worker crashed: ${e.message || 'unknown error'}`);
  w.onmessageerror = () => fail('Speech worker message error');
  worker = w;
  return w;
}

function call(req: Req, onProgress?: OnProgress, transfer: Transferable[] = []): Promise<WorkerResponse> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ ...req, id } as WorkerRequest, transfer);
  });
}

export async function preloadTranscriber(settings: Settings, onProgress?: OnProgress): Promise<void> {
  if (settings.transcription !== 'local') return;
  await call({ type: 'load', model: settings.whisperModel }, onProgress);
  onProgress?.({ stage: 'Ready', progress: 1 });
}

interface OpenAIResult {
  text?: string;
  duration?: number;
  segments?: { start: number; end: number; text: string }[];
}

async function transcribeOpenAI(
  media: Blob,
  settings: Settings,
  onProgress?: OnProgress,
): Promise<OpenAIResult> {
  const key = settings.openaiKey?.trim();
  if (!key)
    throw new Error('OpenAI transcription needs an API key. Add it in Settings or switch to local Whisper.');
  onProgress?.({ stage: 'Uploading to OpenAI' });
  const type = (media.type || 'video/webm').split(';')[0];
  const ext = type.includes('mp4')
    ? 'mp4'
    : type.includes('ogg')
      ? 'ogg'
      : type.includes('wav')
        ? 'wav'
        : 'webm';
  const form = new FormData();
  form.append('file', new File([media], `answer.${ext}`, { type }));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (e) {
    throw new Error(`OpenAI transcription request failed: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  if (!resp.ok) {
    let detail: string;
    try {
      const body = await resp.json();
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      detail = resp.statusText;
    }
    throw new Error(`OpenAI transcription failed (${resp.status}): ${detail || resp.statusText}`);
  }
  onProgress?.({ stage: 'Transcribing', progress: 1 });
  return (await resp.json()) as OpenAIResult;
}

export async function transcribe(
  media: Blob,
  settings: Settings,
  onProgress?: OnProgress,
): Promise<Transcript> {
  if (settings.transcription === 'openai') {
    const engine = 'openai:whisper-1';
    // Decoding is only for the duration and silence check, so a failure here isn't fatal.
    let durationSec = 0;
    let silent = false;
    try {
      const a = await decodeTo16kMono(media);
      durationSec = a.length / SAMPLE_RATE;
      silent = rms(a) < SILENCE_RMS;
    } catch {
      /* fall back to API-reported duration */
    }
    if (silent) return empty(durationSec, engine);
    const reply = await transcribeOpenAI(media, settings, onProgress);
    const segs = (reply.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
    return finish(reply.text ?? '', segs, durationSec || reply.duration || 0, engine);
  }

  onProgress?.({ stage: 'Decoding audio' });
  const audio = await decodeTo16kMono(media);
  const durationSec = audio.length / SAMPLE_RATE;
  const engine = `whisper-local:${settings.whisperModel}`;
  if (rms(audio) < SILENCE_RMS) return empty(durationSec, engine);
  const reply = await call({ type: 'transcribe', model: settings.whisperModel, audio }, onProgress, [
    audio.buffer,
  ]);
  if (reply.type !== 'result') throw new Error('Unexpected speech worker response');
  const segs = reply.chunks.map((c) => ({ start: c.start, end: c.end, text: c.text }));
  return finish(reply.text, segs, durationSec, engine);
}

export async function testTranscription(settings: Settings): Promise<EngineTestResult> {
  if (settings.transcription === 'local') {
    try {
      await preloadTranscriber(settings);
      return { ok: true, message: 'Downloaded and ready' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  const key = settings.openaiKey?.trim();
  if (!key) return { ok: false, message: 'Enter an API key' };
  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (resp.status === 401) return { ok: false, message: 'Invalid API key' };
    if (!resp.ok) return { ok: false, message: `OpenAI error (${resp.status})` };
    return { ok: true, message: 'Connected' };
  } catch {
    return { ok: false, message: "Can't reach OpenAI" };
  }
}
