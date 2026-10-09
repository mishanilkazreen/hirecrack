import type { Settings } from '../types';

const KEY = 'ivp.settings.v1';

// Bounds the Settings form enforces; Interview and Analysing apply the answer-time range again
// in case an old or hand-edited value is in storage.
export const MIN_ANSWER_SECONDS = 60;
export const MAX_ANSWER_SECONDS = 120;
export const MAX_PREP_SECONDS = 60;
export const MAX_ATTEMPTS = 3;

// Phi-3.5-mini, packaged for WebGPU. Smaller models either copied the prompt's example or, in
// Qwen2.5's case, overflowed in fp16 on some GPUs and only produced "!!!!".
export const LOCAL_MODEL = 'onnx-community/Phi-3.5-mini-instruct-onnx-web';
const RETIRED_LOCAL_MODELS = ['onnx-community/Qwen2.5-1.5B-Instruct', 'onnx-community/Qwen3-1.7B-ONNX'];

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  transcription: 'local',
  whisperModel: 'onnx-community/whisper-base.en',
  scoring: 'local',
  localModel: LOCAL_MODEL,
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-5-5',
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  prepSeconds: 30,
  answerSeconds: 90,
  maxAttempts: MAX_ATTEMPTS,
  enableGaze: true,
  cameraId: '',
  micId: '',
  speakerId: '',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage is full or blocked; the settings just won't persist.
  }
}

/** Answer time limit in seconds, clamped to the supported range. */
export function answerLimitSeconds(settings: Settings): number {
  return Math.min(MAX_ANSWER_SECONDS, Math.max(MIN_ANSWER_SECONDS, settings.answerSeconds));
}

function migrate(settings: Settings): Settings {
  let next = settings;
  // Older versions called the built-in scorer 'heuristic'.
  if ((next.scoring as string) === 'heuristic') next = { ...next, scoring: 'rules' };
  // Earlier default local models did not work reliably; move people onto the current one.
  if (RETIRED_LOCAL_MODELS.includes(next.localModel)) next = { ...next, localModel: LOCAL_MODEL };
  return next;
}
