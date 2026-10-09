import { useEffect, useState, useSyncExternalStore } from 'react';
import { preloadScorer, testScoringEngine } from '../lib/scoring';
import { preloadTranscriber, testTranscription } from '../lib/transcribe';
import type { EngineTestResult, ProgressInfo, ScoringEngine, Settings, TranscriptionEngine } from '../types';
import '../report.css';

// Readiness: downloads are remembered in localStorage (and re-checked quietly on load, which is
// fast once cached). Passed API/server tests are remembered for this session only.
const LS_KEY = 'ivp.ready.v1';
const ready = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let hydrated = false;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    if (Array.isArray(raw)) raw.forEach((k) => typeof k === 'string' && ready.add(k));
  } catch {
    // ignore
  }
}

function markReady(key: string) {
  hydrate();
  if (ready.has(key)) return;
  ready.add(key);
  version++;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...ready].filter((k) => k.startsWith('dl:'))));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const sttKey = (s: Settings) =>
  s.transcription === 'local' ? `dl:stt:${s.whisperModel}` : `test:stt:${s.openaiKey.trim()}`;

function scoreKey(s: Settings): string | null {
  switch (s.scoring) {
    case 'rules':
      return null;
    case 'local':
      return `dl:llm:${s.localModel}`;
    case 'anthropic':
      return `test:anthropic:${s.anthropicKey.trim()}:${s.anthropicModel}`;
    case 'openai':
      return `test:openai:${s.openaiKey.trim()}:${s.openaiModel}`;
    case 'ollama':
      return `test:ollama:${s.ollamaUrl}:${s.ollamaModel}`;
  }
}

/** True when both chosen engines are downloaded or tested. Re-renders when that changes. */
export function useEnginesReady(settings: Settings): boolean {
  useSyncExternalStore(subscribe, () => version);
  hydrate();
  const sk = scoreKey(settings);
  return ready.has(sttKey(settings)) && (sk === null || ready.has(sk));
}

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
}

export default function EngineSetup({ settings, onChange }: Props) {
  useSyncExternalStore(subscribe, () => version);
  hydrate();
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  const stk = sttKey(settings);
  const sk = scoreKey(settings);
  const sttReady = ready.has(stk);
  const scoreReady = sk === null || ready.has(sk);

  return (
    <div className="engine-setup">
      <div className="engine-block">
        <label className="field">
          <span className="label">Transcription</span>
          <select
            value={settings.transcription}
            onChange={(e) => set({ transcription: e.target.value as TranscriptionEngine })}
          >
            <option value="local">Local Whisper</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        {settings.transcription === 'local' ? (
          <Download
            key={stk}
            ready={sttReady}
            run={(p) => preloadTranscriber(settings, p)}
            onReady={() => markReady(stk)}
          />
        ) : (
          <ApiKey
            key="stt-openai"
            label="OpenAI API key"
            value={settings.openaiKey}
            onValue={(v) => set({ openaiKey: v })}
            ready={sttReady}
            test={() => testTranscription(settings)}
            onPass={() => markReady(stk)}
          />
        )}
      </div>

      <div className="engine-block">
        <label className="field">
          <span className="label">Scoring</span>
          <select
            value={settings.scoring}
            onChange={(e) => set({ scoring: e.target.value as ScoringEngine })}
          >
            <option value="local">Local AI</option>
            <option value="rules">Built-in rules</option>
            <option value="anthropic">Claude</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
          </select>
        </label>
        {settings.scoring === 'local' && sk && (
          <Download
            key={sk}
            ready={scoreReady}
            run={(p) => preloadScorer(settings, p)}
            onReady={() => markReady(sk)}
          />
        )}
        {settings.scoring === 'anthropic' && sk && (
          <ApiKey
            key="score-anthropic"
            label="Anthropic API key"
            value={settings.anthropicKey}
            onValue={(v) => set({ anthropicKey: v })}
            ready={scoreReady}
            test={() => testScoringEngine(settings)}
            onPass={() => markReady(sk)}
          />
        )}
        {settings.scoring === 'openai' && sk && (
          // The OpenAI key is shared with transcription, so only ask for it once.
          <>
            {settings.transcription !== 'openai' && (
              <label className="field">
                <span className="label">OpenAI API key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.openaiKey}
                  onChange={(e) => set({ openaiKey: e.target.value })}
                />
              </label>
            )}
            <TestRow
              key={sk}
              ready={scoreReady}
              test={() => testScoringEngine(settings)}
              onPass={() => markReady(sk)}
              disabled={!settings.openaiKey.trim()}
            />
          </>
        )}
        {settings.scoring === 'ollama' && sk && (
          <>
            <div className="engine-pair">
              <label className="field">
                <span className="label">Server URL</span>
                <input
                  type="text"
                  value={settings.ollamaUrl}
                  onChange={(e) => set({ ollamaUrl: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">Model</span>
                <input
                  type="text"
                  value={settings.ollamaModel}
                  onChange={(e) => set({ ollamaModel: e.target.value })}
                />
              </label>
            </div>
            <TestRow
              key={sk}
              ready={scoreReady}
              test={() => testScoringEngine(settings)}
              onPass={() => markReady(sk)}
            />
          </>
        )}
      </div>

      <details className="engine-advanced">
        <summary>Advanced</summary>
        <div className="engine-pair">
          <label className="field">
            <span className="label">Whisper model</span>
            <select value={settings.whisperModel} onChange={(e) => set({ whisperModel: e.target.value })}>
              <option value="onnx-community/whisper-tiny.en">tiny: fastest, least accurate</option>
              <option value="onnx-community/whisper-base.en">base: balanced</option>
              <option value="onnx-community/whisper-small.en">small: most accurate, slower</option>
              {!/whisper-(tiny|base|small)\.en$/.test(settings.whisperModel) && (
                <option value={settings.whisperModel}>{settings.whisperModel}</option>
              )}
            </select>
          </label>
          <label className="field">
            <span className="label">Local AI model id</span>
            <input
              type="text"
              value={settings.localModel}
              onChange={(e) => set({ localModel: e.target.value })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

function Download({
  ready: isReady,
  run,
  onReady,
}: {
  ready: boolean;
  run: (onProgress: (p: ProgressInfo) => void) => Promise<void>;
  onReady: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await run(setProgress);
      onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Remembered as downloaded from an earlier visit: load it once more, quietly (quick from cache).
  // Fresh downloads only ever start from the button.
  const wasReady = isReady;
  useEffect(() => {
    if (wasReady) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isReady && !busy) return <p className="engine-status engine-ok">Ready</p>;
  const pct = progress?.progress != null ? Math.round(progress.progress * 100) : null;
  return (
    <div className="engine-action">
      {busy ? (
        <div>
          <div className="small muted">
            {progress ? `${progress.stage}${pct != null ? ` (${pct}%)` : ''}` : 'Loading model'}
          </div>
          <div
            className={`bar bar-thin${pct == null ? ' bar-indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <div className="bar-fill" style={pct != null ? { width: `${pct}%` } : undefined} />
          </div>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => void start()}>
          Download
        </button>
      )}
      {error && (
        <p className="engine-status engine-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function TestRow({
  ready: isReady,
  test,
  onPass,
  disabled,
}: {
  ready: boolean;
  test: () => Promise<EngineTestResult>;
  onPass: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EngineTestResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    let r: EngineTestResult;
    try {
      r = await test();
    } catch (e) {
      r = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    setResult(r);
    setBusy(false);
    if (r.ok) onPass();
  }

  const shown = result ?? (isReady ? { ok: true, message: 'Connected' } : null);
  return (
    <div className="engine-action engine-test">
      <button type="button" className="btn" disabled={busy || disabled} onClick={() => void run()}>
        {busy ? 'Testing…' : 'Test'}
      </button>
      {shown && (
        <span className={`engine-status ${shown.ok ? 'engine-ok' : 'engine-bad'}`} role="status">
          {shown.message}
        </span>
      )}
    </div>
  );
}

function ApiKey({
  label,
  value,
  onValue,
  ready: isReady,
  test,
  onPass,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  ready: boolean;
  test: () => Promise<EngineTestResult>;
  onPass: () => void;
}) {
  return (
    <>
      <label className="field">
        <span className="label">{label}</span>
        <input type="password" autoComplete="off" value={value} onChange={(e) => onValue(e.target.value)} />
      </label>
      {/* Keyed by the key text so an old "Connected" result clears when the key is edited. */}
      <TestRow key={value.trim()} ready={isReady} test={test} onPass={onPass} disabled={!value.trim()} />
    </>
  );
}
