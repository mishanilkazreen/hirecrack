// Shared types for the UI, gaze, transcription and scoring modules.
// Changing a shape here means updating every module that uses it.

export type Competency =
  | 'teamwork'
  | 'problem_solving'
  | 'communication'
  | 'adaptability'
  | 'drive'
  | 'customer_focus'
  | 'leadership'
  | 'integrity';

export type QuestionCategory =
  'behavioral' | 'situational' | 'motivational' | 'graduate' | 'customer' | 'technical';

export interface Question {
  id: string;
  text: string;
  category: QuestionCategory;
  competencies: Competency[];
}

// Gaze / eye contact (src/lib/gaze)

export interface GazeSample {
  t: number; // ms since tracking started
  faceDetected: boolean;
  lookingAtCamera: boolean; // false when no face
  yaw: number; // degrees, head left/right (0 = facing camera)
  pitch: number; // degrees, head up/down
  irisOffsetX: number; // -1..1, horizontal iris position within the eye (0 = centred)
  irisOffsetY: number; // -1..1
}

export interface GazeSummary {
  durationSec: number;
  sampleCount: number;
  faceDetectedPct: number; // 0-100
  eyeContactPct: number; // 0-100, of total time
  lookAwayEvents: number; // look-aways lasting > 1s
  longestLookAwaySec: number;
  multipleFacesDetected: boolean;
  timeline: { t: number; looking: boolean }[]; // downsampled (~4 Hz) for the results chart
}

export interface GazeTracker {
  /** Starts analysing frames from a video element that is already playing. Clears any earlier samples. */
  start(video: HTMLVideoElement): void;
  /** Stops analysing and returns the summary since start(). */
  stop(): GazeSummary;
  /** Called with every sample, for live indicators. Set by the caller. */
  onSample: ((s: GazeSample) => void) | null;
  dispose(): void;
}

// Transcription (src/lib/transcribe)

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[]; // empty if the engine gives no timestamps
  durationSec: number;
  engine: string; // e.g. "whisper-local:onnx-community/whisper-base.en" or "openai:whisper-1"
}

export interface ProgressInfo {
  stage: string;
  progress?: number; /* 0-1 */
}

// Scoring (src/lib/scoring)
//
// Scores run from negative to positive. Negative means the answer would count against the
// candidate (off-topic, vague, or saying something an employer would see as a red flag),
// zero is neutral, positive means it would help. Content quality drives the score, not
// whether the answer followed a template like STAR.

export type Verdict = 'Very negative' | 'Negative' | 'Neutral' | 'Positive' | 'Very positive';

// Rating for one aspect of the answer, -2 (hurts a lot) to +2 (helps a lot).
export type AspectRating = -2 | -1 | 0 | 1 | 2;

export type AspectKey = 'relevance' | 'substance' | 'judgement' | 'impact' | 'clarity';

export interface AspectScore {
  key: AspectKey;
  label: string; // e.g. "Answered the question"
  rating: AspectRating;
  comment: string; // one or two plain sentences about this answer, not generic advice
}

// One specific observation tied to what the candidate actually said.
export interface FeedbackPoint {
  kind: 'positive' | 'negative' | 'red_flag';
  quote: string; // the candidate's own words this is about ('' if it's about something missing)
  comment: string; // why it helps or hurts, in plain language
  suggestion?: string; // for negative/red_flag: what to say or do instead
}

export interface DeliveryMetrics {
  wordCount: number;
  wpm: number;
  fillerCount: number;
  fillerRatePerMin: number;
  fillersFound: Record<string, number>;
  timeUsedPct: number; // answer duration / max allowed, 0-100
  longPauses: number; // gaps > 3s between segments (0 if no segments)
}

export interface Evaluation {
  score: number; // -100 to 100, see the note above
  verdict: Verdict; // <= -50 Very negative, < -15 Negative, <= 15 Neutral, < 50 Positive, else Very positive
  summary: string; // two or three direct sentences on how this answer would land with an employer
  aspects: AspectScore[]; // one per AspectKey, in AspectKey order
  points: FeedbackPoint[]; // red flags first, then negatives, then positives
  betterAnswer?: string; // a short outline of a stronger answer built from the candidate's own story (AI engines only)
  delivery: DeliveryMetrics; // how they said it; shown separately, nudges the score only slightly
  presence: GazeSummary | null; // eye contact, shown separately, never part of `score`
  source: 'rules' | 'ai';
  model?: string; // e.g. "local:onnx-community/Qwen3-1.7B-ONNX" or "anthropic:claude-sonnet-5-5"
  warning?: string; // e.g. "AI scoring failed (openai): <reason>. Showing the built-in rules score instead."
}

export interface EngineTestResult {
  ok: boolean;
  message: string; // short, shown next to the Test button, e.g. "Connected" or "Invalid API key"
}

export interface ScoreInput {
  question: Question;
  transcript: Transcript;
  gaze: GazeSummary | null;
  durationSec: number;
  maxSeconds: number;
}

// Settings (persisted in localStorage by src/lib/settings.ts)

export type TranscriptionEngine = 'local' | 'openai';
// 'rules' = built-in keyword rules (instant, can't really judge meaning)
// 'local' = small LLM running in the app (free, offline after a one-time download)
export type ScoringEngine = 'rules' | 'local' | 'anthropic' | 'openai' | 'ollama';

export interface Settings {
  onboarded: boolean; // false until the first-launch engine setup is finished
  transcription: TranscriptionEngine;
  whisperModel: string; // HF model id for local whisper
  scoring: ScoringEngine;
  localModel: string; // HF model id for the in-app scoring LLM
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  prepSeconds: number; // think time before recording (0 = start immediately)
  answerSeconds: number; // 60-120
  maxAttempts: number; // default 3
  enableGaze: boolean;
  cameraId: string; // MediaDeviceInfo.deviceId, '' = system default
  micId: string;
  speakerId: string; // used with HTMLMediaElement.setSinkId for playback
}

// Session results (UI state and saved history)
// The recording itself is stored separately in IndexedDB by src/lib/videoStore.ts, keyed by `id`.

export interface AttemptResult {
  id: string;
  question: Question;
  createdAt: number;
  attemptsUsed: number;
  durationSec: number;
  transcript: Transcript;
  evaluation: Evaluation;
}

// Module entry points. Each module exports exactly these:
//
// src/lib/gaze/index.ts:
//   export async function createGazeTracker(): Promise<GazeTracker>
//
// src/lib/transcribe/index.ts:
//   export async function transcribe(media: Blob, settings: Settings, onProgress?: (p: ProgressInfo) => void): Promise<Transcript>
//   export async function preloadTranscriber(settings: Settings, onProgress?: (p: ProgressInfo) => void): Promise<void>
//   export async function testTranscription(settings: Settings): Promise<EngineTestResult>
//     local: confirms the model is downloaded and loads; openai: checks the key with a cheap request.
//
// src/lib/scoring/index.ts:
//   export async function scoreAnswer(input: ScoreInput, settings: Settings, onProgress?: (p: ProgressInfo) => void): Promise<Evaluation>
//     Never throws for AI failures: it falls back to the built-in rules and sets `warning`.
//   export async function preloadScorer(settings: Settings, onProgress?: (p: ProgressInfo) => void): Promise<void>
//     Downloads/loads the local model when scoring === 'local'; resolves immediately otherwise.
//   export async function testScoringEngine(settings: Settings): Promise<EngineTestResult>
//     Sends a tiny prompt to the chosen engine and checks it answers.
//
// src/lib/videoStore.ts:
//   export async function saveVideo(id: string, blob: Blob): Promise<void>   (keeps the newest 20)
//   export async function loadVideo(id: string): Promise<Blob | null>
//   export async function clearVideos(): Promise<void>
//
// src/components/EngineSetup.tsx (shared by first-launch onboarding and the Settings page):
//   export default function EngineSetup(props: { settings: Settings; onChange: (next: Settings) => void }): JSX.Element
//     Transcription + scoring engine dropdowns, download progress bars, API key fields and Test buttons.
//
// src/pages/Onboarding.tsx:
//   export default function Onboarding(props: { settings: Settings; onDone: (next: Settings) => void }): JSX.Element
//     onDone receives settings with onboarded: true; App saves them.
