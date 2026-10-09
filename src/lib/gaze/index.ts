import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { GazeSample, GazeSummary, GazeTracker } from '../../types';
import { anglesFromMatrix, irisOffset, isLooking, majority, summarise, SMOOTHING_WINDOW } from './math';

const MP_VERSION = '1.1.0';
const BASE = import.meta.env.BASE_URL;
const LOCAL_WASM = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}mediapipe/face_landmarker.task`;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MAX_FPS = 15; // plenty for gaze, and keeps CPU use down
const MIN_FRAME_MS = 1000 / MAX_FPS;

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

async function build(wasm: string, model: string): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(wasm);
  const make = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
    });
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

/** Loads the model once and shares it. Prefers the bundled copy, falls back to the CDN. */
function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = build(LOCAL_WASM, LOCAL_MODEL)
      .catch(() => build(CDN_WASM, CDN_MODEL))
      .catch((e) => {
        landmarkerPromise = null; // let the next call retry
        throw e;
      });
  }
  return landmarkerPromise;
}

/** HTMLVideoElement with requestVideoFrameCallback, which older TypeScript DOM typings lack. */
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback(cb: () => void): number;
  cancelVideoFrameCallback?(handle: number): void;
};

export async function createGazeTracker(): Promise<GazeTracker> {
  const landmarker = await getLandmarker();

  let video: HTMLVideoElement | null = null;
  let running = false;
  let handle = 0;
  let useRvfc = false;
  let startedAt = 0;
  let lastProcessed = -Infinity;
  let lastVideoTime = -1;
  let samples: GazeSample[] = [];
  let recentLooks: boolean[] = [];
  let multiFaceFrames = 0;
  let lastStopMs = 0; // kept so a second stop() reports the same duration

  const cancel = () => {
    if (!video) return;
    if (useRvfc) (video as RvfcVideo).cancelVideoFrameCallback?.(handle);
    else cancelAnimationFrame(handle);
  };

  const schedule = () => {
    if (!running || !video) return;
    useRvfc = 'requestVideoFrameCallback' in video;
    handle = useRvfc ? (video as RvfcVideo).requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  };

  const tick = () => {
    if (!running || !video) return;
    const now = performance.now();
    if (now - lastProcessed >= MIN_FRAME_MS && video.currentTime !== lastVideoTime && video.readyState >= 2) {
      lastProcessed = now;
      lastVideoTime = video.currentTime;
      try {
        processFrame(now);
      } catch {
        // One bad frame shouldn't end the session.
      }
    }
    schedule();
  };

  const processFrame = (now: number) => {
    const res = landmarker.detectForVideo(video!, now);
    const faces = res.faceLandmarks?.length ?? 0;
    const faceDetected = faces > 0;
    let yaw = 0;
    let pitch = 0;
    let ix = 0;
    let iy = 0;
    if (faceDetected) {
      const m = res.facialTransformationMatrixes?.[0]?.data;
      if (m) ({ yaw, pitch } = anglesFromMatrix(m));
      ({ x: ix, y: iy } = irisOffset(res.faceLandmarks[0]));
    }
    if (faces > 1) multiFaceFrames++;

    recentLooks.push(isLooking({ faceDetected, yaw, pitch, irisOffsetX: ix, irisOffsetY: iy }));
    if (recentLooks.length > SMOOTHING_WINDOW) recentLooks.shift();
    const sample: GazeSample = {
      t: now - startedAt,
      faceDetected,
      lookingAtCamera: faceDetected && majority(recentLooks),
      yaw,
      pitch,
      irisOffsetX: ix,
      irisOffsetY: iy,
    };
    samples.push(sample);
    tracker.onSample?.(sample);
  };

  const halt = () => {
    cancel();
    running = false;
  };

  const tracker: GazeTracker = {
    onSample: null,
    start(v) {
      halt();
      video = v;
      samples = [];
      recentLooks = [];
      multiFaceFrames = 0;
      lastProcessed = -Infinity;
      lastVideoTime = -1;
      startedAt = performance.now();
      running = true;
      schedule();
    },
    stop(): GazeSummary {
      if (running) lastStopMs = performance.now() - startedAt;
      halt();
      return summarise(samples, multiFaceFrames, lastStopMs);
    },
    dispose() {
      halt();
      tracker.onSample = null;
    },
  };
  return tracker;
}
