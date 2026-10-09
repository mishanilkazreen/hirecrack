// Runs on postinstall. Copies the MediaPipe WASM into public/ and downloads the face landmarker
// model, so the app and the packaged exe work offline. (src/lib/gaze/index.ts falls back to a CDN
// if the model isn't there.)
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
mkdirSync(out, { recursive: true });

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
if (existsSync(wasmSrc)) cpSync(wasmSrc, join(out, 'wasm'), { recursive: true });

const modelPath = join(out, 'face_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
if (!existsSync(modelPath)) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('Downloaded face_landmarker.task');
  } catch (err) {
    console.warn(
      `Could not download face model (${err.message}); the app will fetch it from the CDN at runtime.`,
    );
  }
}
