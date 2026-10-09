import { useEffect, useState } from 'react';
import { scoreAnswer } from '../lib/scoring';
import { answerLimitSeconds } from '../lib/settings';
import { saveVideo } from '../lib/videoStore';
import { transcribe } from '../lib/transcribe';
import type { AttemptResult, ProgressInfo, Question, Settings } from '../types';
import type { Take } from './Interview';

interface Props {
  question: Question;
  settings: Settings;
  take: Take;
  onDone: (result: AttemptResult) => void;
  onBack: () => void;
}

type Step = 'transcribing' | 'scoring';

export default function Analysing({ question, settings, take, onDone, onBack }: Props) {
  const [step, setStep] = useState<Step>('transcribing');
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0); // Retry bumps this to rerun the effect

  useEffect(() => {
    let cancelled = false;
    setStep('transcribing');
    setProgress(null);
    setError(null);
    (async () => {
      try {
        const transcript = await transcribe(take.blob, settings, (p) => !cancelled && setProgress(p));
        if (cancelled) return;
        setStep('scoring');
        setProgress(null);
        const evaluation = await scoreAnswer(
          {
            question,
            transcript,
            gaze: take.gaze,
            durationSec: take.durationSec,
            maxSeconds: answerLimitSeconds(settings),
          },
          settings,
          (p) => !cancelled && setProgress(p),
        );
        if (cancelled) return;
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        await saveVideo(id, take.blob);
        if (cancelled) return;
        onDone({
          id,
          question,
          createdAt: Date.now(),
          attemptsUsed: take.attemptsUsed,
          durationSec: take.durationSec,
          transcript,
          evaluation,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  const pct = progress?.progress != null ? Math.round(progress.progress * 100) : null;
  const stepState = (s: Step) => {
    if (step === s) return error ? 'error' : 'active';
    return step === 'scoring' && s === 'transcribing' ? 'done' : 'todo';
  };

  return (
    <section className="page narrow">
      <h2>Analysing your answer</h2>
      <ol className="steps" aria-live="polite">
        {(['transcribing', 'scoring'] as const).map((s) => (
          <li key={s} className={`step step-${stepState(s)}`}>
            <span className="step-mark" aria-hidden="true" />
            <div>
              <div>{s === 'transcribing' ? 'Transcribing' : 'Scoring'}</div>
              {step === s && !error && (
                <div className="small muted">
                  {progress ? `${progress.stage}${pct != null ? ` (${pct}%)` : ''}` : 'Starting...'}
                </div>
              )}
              {step === s && !error && progress && (
                <div
                  className={`bar bar-thin${pct == null ? ' bar-indeterminate' : ''}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct ?? undefined}
                >
                  <div className="bar-fill" style={pct != null ? { width: `${pct}%` } : undefined} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => setRetryCount((n) => n + 1)}>
              Retry
            </button>
            <button type="button" className="btn" onClick={onBack}>
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
