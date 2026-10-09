import { describe, expect, it } from 'vitest';
import type { GazeSample } from '../../types';
import { anglesFromMatrix, emptySummary, irisOffset, isLooking, majority, summarise } from './math';

const sample = (t: number, looking: boolean, faceDetected = true): GazeSample => ({
  t,
  faceDetected,
  lookingAtCamera: looking,
  yaw: 0,
  pitch: 0,
  irisOffsetX: 0,
  irisOffsetY: 0,
});

/** One sample every 100 ms following the given looking pattern. */
const series = (pattern: boolean[]) => pattern.map((l, i) => sample(i * 100, l));
const run = (looking: boolean, n: number) => Array<boolean>(n).fill(looking);

describe('summarise', () => {
  it('returns an empty summary with zero samples', () => {
    expect(summarise([], 0, 5000)).toEqual(emptySummary(5));
    expect(summarise([], 0, 5000).sampleCount).toBe(0);
  });

  it('computes eye contact percentage', () => {
    const s = summarise(series([true, true, true, false]), 0, 400);
    expect(s.eyeContactPct).toBe(75);
    expect(s.faceDetectedPct).toBe(100);
    expect(s.sampleCount).toBe(4);
  });

  it('counts only look-aways longer than 1s', () => {
    const pattern = [
      ...run(true, 10),
      ...run(false, 5),
      ...run(true, 10),
      ...run(false, 15),
      ...run(true, 10),
    ];
    const s = summarise(series(pattern), 0, pattern.length * 100);
    expect(s.lookAwayEvents).toBe(1); // the 0.5s look-away is ignored, the 1.5s one counts
    expect(s.longestLookAwaySec).toBe(1.5);
  });

  it('counts a look-away that runs to the end of the session', () => {
    const pattern = [true, ...run(false, 20)];
    const s = summarise(series(pattern), 0, pattern.length * 100);
    expect(s.lookAwayEvents).toBe(1);
  });

  it('flags multiple faces when more than 10% of frames have them', () => {
    const samples = series(run(true, 10));
    expect(summarise(samples, 1, 1000).multipleFacesDetected).toBe(false);
    expect(summarise(samples, 2, 1000).multipleFacesDetected).toBe(true);
  });

  it('downsamples the timeline to about 4 Hz', () => {
    const s = summarise(series(run(true, 40)), 0, 4000); // 4s at 10 Hz
    expect(s.timeline.length).toBeGreaterThanOrEqual(12);
    expect(s.timeline.length).toBeLessThanOrEqual(16); // vs 40 raw samples
  });

  it('reports face detection separately from looking', () => {
    const s = summarise([sample(0, false, false), sample(100, true, true)], 0, 200);
    expect(s.faceDetectedPct).toBe(50);
    expect(s.eyeContactPct).toBe(50);
  });
});

describe('majority', () => {
  it('returns the majority value', () => {
    expect(majority([true, true, false])).toBe(true);
    expect(majority([false, false, true, true, false])).toBe(false);
  });

  it('breaks ties in favour of the latest value', () => {
    expect(majority([true, false])).toBe(false);
    expect(majority([false, true])).toBe(true);
  });

  it('smooths a single-frame blip', () => {
    expect(majority([true, true, false, true, true])).toBe(true);
  });
});

describe('isLooking', () => {
  const base = { faceDetected: true, yaw: 0, pitch: 0, irisOffsetX: 0, irisOffsetY: 0 };

  it('is true when facing the camera', () => {
    expect(isLooking(base)).toBe(true);
  });

  it('is false with no face, or when head or iris is off-axis', () => {
    expect(isLooking({ ...base, faceDetected: false })).toBe(false);
    expect(isLooking({ ...base, yaw: 25 })).toBe(false);
    expect(isLooking({ ...base, pitch: -25 })).toBe(false);
    expect(isLooking({ ...base, irisOffsetX: 0.5 })).toBe(false);
    expect(isLooking({ ...base, irisOffsetY: -0.6 })).toBe(false);
  });
});

describe('anglesFromMatrix', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Rotation about the Y axis by `a` radians, column-major.
  const rotY = (a: number) => [
    Math.cos(a),
    0,
    -Math.sin(a),
    0,
    0,
    1,
    0,
    0,
    Math.sin(a),
    0,
    Math.cos(a),
    0,
    0,
    0,
    0,
    1,
  ];
  // Rotation about the X axis by `a` radians, column-major.
  const rotX = (a: number) => [
    1,
    0,
    0,
    0,
    0,
    Math.cos(a),
    Math.sin(a),
    0,
    0,
    -Math.sin(a),
    Math.cos(a),
    0,
    0,
    0,
    0,
    1,
  ];

  it('is zero for a head facing the camera', () => {
    const { yaw, pitch } = anglesFromMatrix(identity);
    expect(yaw).toBeCloseTo(0);
    expect(pitch).toBeCloseTo(0);
  });

  it('reads yaw from a rotation about the vertical axis', () => {
    const rad = (20 * Math.PI) / 180;
    expect(Math.abs(anglesFromMatrix(rotY(rad)).yaw)).toBeCloseTo(20, 3);
    expect(anglesFromMatrix(rotY(rad)).yaw).toBeCloseTo(-anglesFromMatrix(rotY(-rad)).yaw, 3);
  });

  it('reads pitch from a rotation about the horizontal axis', () => {
    const rad = (15 * Math.PI) / 180;
    expect(Math.abs(anglesFromMatrix(rotX(rad)).pitch)).toBeCloseTo(15, 3);
  });

  it('ignores uniform scale in the matrix', () => {
    const rad = (20 * Math.PI) / 180;
    const scaled = rotY(rad).map((v, i) => (i % 4 === 3 ? v : v * 7));
    expect(anglesFromMatrix(scaled).yaw).toBeCloseTo(anglesFromMatrix(rotY(rad)).yaw, 3);
  });

  it('folds a flipped-axis yaw near 180 back into -90..90', () => {
    const { yaw } = anglesFromMatrix(rotY(Math.PI - 0.1));
    expect(Math.abs(yaw)).toBeLessThan(90);
  });
});

describe('irisOffset', () => {
  const pts = (n: number) => Array.from({ length: n }, () => ({ x: 0, y: 0 }));

  it('returns zero when the model gave no iris landmarks', () => {
    expect(irisOffset(pts(468))).toEqual({ x: 0, y: 0 });
    expect(irisOffset([])).toEqual({ x: 0, y: 0 });
  });

  it('is zero for iris points exactly between the eye corners and lids', () => {
    const lm = pts(478);
    const eye = { iris: 468, cornerA: 33, cornerB: 133, lidTop: 159, lidBottom: 145 };
    const right = { iris: 473, cornerA: 263, cornerB: 362, lidTop: 386, lidBottom: 374 };
    for (const [e, cx] of [
      [eye, 100],
      [right, 200],
    ] as const) {
      lm[e.cornerA] = { x: cx - 10, y: 50 };
      lm[e.cornerB] = { x: cx + 10, y: 50 };
      lm[e.lidTop] = { x: cx, y: 45 };
      lm[e.lidBottom] = { x: cx, y: 55 };
      lm[e.iris] = { x: cx, y: 50 };
    }
    const o = irisOffset(lm);
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0);
  });

  it('always stays within -1..1', () => {
    const lm = pts(478).map((_, i) => ({ x: (i * 37) % 11, y: (i * 53) % 7 }));
    const o = irisOffset(lm);
    expect(Math.abs(o.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(o.y)).toBeLessThanOrEqual(1);
  });
});
