import type { GazeSample, GazeSummary } from '../../types';

// Head pose and iris position must stay inside these limits to count as "looking at the camera".
const MAX_YAW_DEG = 20;
const MAX_PITCH_DEG = 20;
const MAX_IRIS_X = 0.35;
const MAX_IRIS_Y = 0.45;
/** Raw per-frame verdicts are smoothed with a majority vote over this many frames. */
export const SMOOTHING_WINDOW = 5;
const LOOK_AWAY_MIN_SEC = 1;
/** Flag the session when a second face shows up in more than this share of frames. */
const MULTI_FACE_RATIO = 0.1;
const TIMELINE_HZ = 4;
/** Samples further apart than this (tab hidden, camera stalled) only count for this long. */
const MAX_SAMPLE_GAP_MS = 1000;

// MediaPipe face mesh landmark indices. The mesh has 468 points plus 5 per iris (468-472 left, 473-477 right).
const LANDMARK_COUNT = 478;
const LEFT_EYE = { iris: 468, cornerA: 33, cornerB: 133, lidTop: 159, lidBottom: 145 };
const RIGHT_EYE = { iris: 473, cornerA: 263, cornerB: 362, lidTop: 386, lidBottom: 374 };

export interface Pt {
  x: number;
  y: number;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const deg = (r: number) => (r * 180) / Math.PI;

/** Yaw/pitch (degrees) from a column-major 4x4 facial transformation matrix. */
export function anglesFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number } {
  // r(row, col) = m[col * 4 + row]. Columns are normalised in case the matrix carries scale.
  const len = (c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]) || 1;
  const r = (row: number, col: number) => m[col * 4 + row] / len(col);
  let yaw = deg(Math.atan2(r(0, 2), r(2, 2)));
  const pitch = deg(Math.asin(clamp(-r(1, 2))));
  // The matrix can come back with flipped axes, which shows up as a yaw near +/-180.
  if (yaw > 90) yaw -= 180;
  else if (yaw < -90) yaw += 180;
  return { yaw, pitch };
}

/** Iris offset within one eye, each axis -1..1 (0 = centred). */
function eyeIrisOffset(
  iris: Pt,
  cornerA: Pt,
  cornerB: Pt,
  lidTop: Pt,
  lidBottom: Pt,
): { x: number; y: number } {
  const ax = cornerB.x - cornerA.x,
    ay = cornerB.y - cornerA.y;
  const w = Math.hypot(ax, ay) || 1e-6;
  const mx = (cornerA.x + cornerB.x) / 2,
    my = (cornerA.y + cornerB.y) / 2;
  const x = ((iris.x - mx) * ax + (iris.y - my) * ay) / w / (w / 2);
  const lidMid = (lidTop.y + lidBottom.y) / 2;
  // Floor the lid opening so a blink doesn't blow up the ratio.
  const half = Math.max(Math.abs(lidBottom.y - lidTop.y) / 2, w * 0.1);
  return { x: clamp(x), y: clamp((iris.y - lidMid) / half) };
}

/** Averaged iris offset over both eyes from the 478-point landmark list. */
export function irisOffset(lm: Pt[]): { x: number; y: number } {
  if (lm.length < LANDMARK_COUNT) return { x: 0, y: 0 }; // model returned no iris points
  const offset = (e: typeof LEFT_EYE) =>
    eyeIrisOffset(lm[e.iris], lm[e.cornerA], lm[e.cornerB], lm[e.lidTop], lm[e.lidBottom]);
  // The right eye's corners are listed in the opposite order, so both eyes measure the same direction.
  const l = offset(LEFT_EYE);
  const r = offset(RIGHT_EYE);
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}

export function isLooking(
  s: Pick<GazeSample, 'faceDetected' | 'yaw' | 'pitch' | 'irisOffsetX' | 'irisOffsetY'>,
): boolean {
  return (
    s.faceDetected &&
    Math.abs(s.yaw) < MAX_YAW_DEG &&
    Math.abs(s.pitch) < MAX_PITCH_DEG &&
    Math.abs(s.irisOffsetX) < MAX_IRIS_X &&
    Math.abs(s.irisOffsetY) < MAX_IRIS_Y
  );
}

/** Majority vote of recent raw booleans (ties favour the latest value). */
export function majority(history: boolean[]): boolean {
  const yes = history.filter(Boolean).length;
  const no = history.length - yes;
  return yes === no ? history[history.length - 1] : yes > no;
}

export function emptySummary(durationSec = 0): GazeSummary {
  return {
    durationSec,
    sampleCount: 0,
    faceDetectedPct: 0,
    eyeContactPct: 0,
    lookAwayEvents: 0,
    longestLookAwaySec: 0,
    multipleFacesDetected: false,
    timeline: [],
  };
}

/** Builds the session summary. Each sample is weighted by the time until the next one. */
export function summarise(samples: GazeSample[], multiFaceFrames: number, totalMs: number): GazeSummary {
  const n = samples.length;
  if (n === 0) return emptySummary(Math.max(0, totalMs) / 1000);

  const dur = samples.map((s, i) => {
    const end = i + 1 < n ? samples[i + 1].t : Math.max(totalMs, s.t);
    return Math.min(Math.max(end - s.t, 0), MAX_SAMPLE_GAP_MS);
  });
  const total = dur.reduce((a, b) => a + b, 0) || 1;
  let face = 0,
    look = 0,
    run = 0,
    longest = 0,
    events = 0;
  const closeRun = () => {
    if (run > LOOK_AWAY_MIN_SEC * 1000) events++;
    longest = Math.max(longest, run);
    run = 0;
  };
  samples.forEach((s, i) => {
    if (s.faceDetected) face += dur[i];
    if (s.lookingAtCamera) {
      look += dur[i];
      closeRun();
    } else run += dur[i];
  });
  closeRun();

  const timeline: GazeSummary['timeline'] = [];
  const step = 1000 / TIMELINE_HZ;
  let next = 0;
  for (const s of samples) {
    if (s.t >= next) {
      timeline.push({ t: s.t, looking: s.lookingAtCamera });
      next = s.t + step;
    }
  }

  const pct = (v: number) => Math.round((v / total) * 1000) / 10;
  return {
    durationSec: Math.max(totalMs, samples[n - 1].t) / 1000,
    sampleCount: n,
    faceDetectedPct: pct(face),
    eyeContactPct: pct(look),
    lookAwayEvents: events,
    longestLookAwaySec: Math.round(longest) / 1000,
    multipleFacesDetected: multiFaceFrames / n > MULTI_FACE_RATIO,
    timeline,
  };
}
