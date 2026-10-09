// Main-thread client for the in-app scoring LLM worker (one shared worker, requests matched by id).
import type { ProgressInfo } from '../../types';
import type { WorkerRequest, WorkerResponse } from './llm.worker';

type OnProgress = (p: ProgressInfo) => void;
type Req =
  | { type: 'load'; model: string }
  | { type: 'generate'; model: string; system: string; user: string; maxNewTokens: number; prefill: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (m: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: OnProgress }
>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
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
  w.onerror = (e) => fail(`Scoring worker crashed: ${e.message || 'unknown error'}`);
  w.onmessageerror = () => fail('Scoring worker message error');
  worker = w;
  return w;
}

function call(req: Req, onProgress?: OnProgress): Promise<WorkerResponse> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ ...req, id } as WorkerRequest);
  });
}

/** Cap on generated tokens. The lean local format is about 400 to 700 tokens; this leaves margin. */
export const MAX_NEW_TOKENS = 1100;

export async function loadLocalModel(model: string, onProgress?: OnProgress): Promise<void> {
  await call({ type: 'load', model }, onProgress);
  onProgress?.({ stage: 'Ready', progress: 1 });
}

export async function generateLocal(
  model: string,
  system: string,
  user: string,
  onProgress?: OnProgress,
  opts: { prefill?: string; maxNewTokens?: number } = {},
): Promise<string> {
  const r = await call(
    {
      type: 'generate',
      model,
      system,
      user,
      maxNewTokens: opts.maxNewTokens ?? MAX_NEW_TOKENS,
      prefill: opts.prefill ?? '',
    },
    onProgress,
  );
  if (r.type !== 'result') throw new Error('Unexpected scoring worker response');
  // The reply continues the prefill, so put it back for the parser.
  return (opts.prefill ?? '') + r.text;
}
