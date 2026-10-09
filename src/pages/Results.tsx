import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../components/Timer';
import rubric from '../data/rubric.json';
import { fixWebmDuration, useSinkId } from '../lib/media';
import { loadSettings } from '../lib/settings';
import { loadVideo } from '../lib/videoStore';
import type { AspectRating, AttemptResult, FeedbackPoint } from '../types';
import '../report.css';

const [MIN_WPM, MAX_WPM] = rubric.idealWpm;

interface Props {
  result: AttemptResult;
  onNext: () => void;
  onRetry: () => void;
  onHome: () => void;
}

const VERDICT_TONE = (score: number) => (score < -15 ? 'neg' : score > 15 ? 'pos' : 'neutral');

export default function Results({ result, onNext, onRetry, onHome }: Props) {
  const { evaluation: ev, transcript, question } = result;
  const delivery = ev.delivery;
  const tone = VERDICT_TONE(ev.score);
  const score = Math.max(-100, Math.min(100, Math.round(ev.score)));
  const redFlags = ev.points.filter((p) => p.kind === 'red_flag');
  const points = ev.points.filter((p) => p.kind !== 'red_flag');
  const topFillers = Object.entries(delivery.fillersFound)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const paceNote =
    delivery.wpm === 0
      ? ''
      : delivery.wpm < MIN_WPM
        ? 'a bit slow'
        : delivery.wpm > MAX_WPM
          ? 'a bit fast'
          : 'good';

  return (
    <section className="page report">
      <p className="small muted">{question.text}</p>

      <div className="report-top">
        <RecordingPlayer id={result.id} />

        <div className="card report-score">
          <div className={`verdict verdict-${tone}`}>{ev.verdict}</div>
          <div className="scale" role="img" aria-label={`Score ${score} on a scale from -100 to 100`}>
            <div className="scale-track" />
            <div className="scale-zero" />
            <div className={`scale-marker marker-${tone}`} style={{ left: `${(score + 100) / 2}%` }} />
          </div>
          <div className="scale-labels small muted" aria-hidden="true">
            <span>-100</span>
            <span>0</span>
            <span>+100</span>
          </div>
          <p className="small muted score-num">
            Score {score > 0 ? '+' : ''}
            {score}. Answer length {formatClock(result.durationSec)}, attempt {result.attemptsUsed}.
          </p>
          <p className="report-summary">{ev.summary}</p>
        </div>
      </div>

      {ev.warning && <p className="small warning-text">{ev.warning}</p>}

      {redFlags.length > 0 && (
        <div className="redflags" role="alert">
          <h3>Red flags</h3>
          {redFlags.map((p, i) => (
            <Point key={i} point={p} />
          ))}
        </div>
      )}

      {points.length > 0 && (
        <div className="card">
          <h3>What you said</h3>
          <div className="points">
            {points.map((p, i) => (
              <Point key={i} point={p} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Aspects</h3>
        <ul className="aspects">
          {ev.aspects.map((a) => (
            <li key={a.key}>
              <Rating value={a.rating} />
              <div>
                <div className="aspect-label">{a.label}</div>
                <div className="small muted">{a.comment}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {ev.betterAnswer && (
        <div className="card better">
          <h3>A stronger answer</h3>
          <p className="better-text">{ev.betterAnswer}</p>
        </div>
      )}

      <div className="card">
        <h3>
          How you said it{' '}
          <span
            className="info"
            tabIndex={0}
            title="For practice. Delivery nudges the score slightly. Eye contact is never part of it."
            aria-label="For practice. Delivery nudges the score slightly. Eye contact is never part of it."
          >
            ?
          </span>
        </h3>
        <dl className="stats">
          <div>
            <dt>Pace</dt>
            <dd>
              {Math.round(delivery.wpm)} wpm
              <span className="small muted">
                {' '}
                ideal {MIN_WPM}-{MAX_WPM}
                {paceNote && `, ${paceNote}`}
              </span>
            </dd>
          </div>
          <div>
            <dt>Filler words</dt>
            <dd>
              {delivery.fillerCount}
              <span className="small muted">
                {' '}
                ({delivery.fillerRatePerMin.toFixed(1)}/min
                {topFillers.length > 0 && `: ${topFillers.map(([w, n]) => `${w} x${n}`).join(', ')}`})
              </span>
            </dd>
          </div>
          <div>
            <dt>Time used</dt>
            <dd>{Math.round(delivery.timeUsedPct)}%</dd>
          </div>
          <div>
            <dt>Words</dt>
            <dd>{delivery.wordCount}</dd>
          </div>
          {ev.presence && (
            <>
              <div>
                <dt>Eye contact</dt>
                <dd>{Math.round(ev.presence.eyeContactPct)}%</dd>
              </div>
              <div>
                <dt>Look-aways</dt>
                <dd>{ev.presence.lookAwayEvents}</dd>
              </div>
            </>
          )}
        </dl>
        {ev.presence && ev.presence.timeline.length > 0 && (
          <div
            className="timeline"
            role="img"
            aria-label="Eye contact timeline: green is looking at camera, grey is looking away"
          >
            {ev.presence.timeline.map((p, i) => (
              <span key={i} className={p.looking ? 'seg seg-on' : 'seg'} />
            ))}
          </div>
        )}
      </div>

      <details className="card">
        <summary>Transcript</summary>
        <p className="transcript">{transcript.text || '(no speech detected)'}</p>
      </details>

      <p className="small muted">
        {ev.source === 'rules' ? 'Scored by built-in rules' : `Scored by ${ev.model ?? 'AI'}`}
      </p>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={onNext}>
          Next question
        </button>
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="btn" onClick={onHome}>
          Home
        </button>
      </div>
    </section>
  );
}

function Point({ point }: { point: FeedbackPoint }) {
  const bad = point.kind !== 'positive';
  return (
    <div className={`point point-${point.kind}`}>
      <span className="point-icon" aria-hidden="true">
        {point.kind === 'red_flag' ? '!' : bad ? '-' : '+'}
      </span>
      <div>
        <span className="sr-only">
          {point.kind === 'red_flag' ? 'Red flag. ' : bad ? 'Hurts. ' : 'Helps. '}
        </span>
        {point.quote && <blockquote>{point.quote}</blockquote>}
        <p>{point.comment}</p>
        {bad && point.suggestion && (
          <p className="suggestion">
            <strong>Try:</strong> {point.suggestion}
          </p>
        )}
      </div>
    </div>
  );
}

function Rating({ value }: { value: AspectRating }) {
  const tone = value < 0 ? 'neg' : value > 0 ? 'pos' : 'neutral';
  const width = (Math.abs(value) / 2) * 50;
  return (
    <span
      className="rating"
      role="img"
      aria-label={`Rating ${value > 0 ? '+' : ''}${value} out of 2`}
      title={`${value > 0 ? '+' : ''}${value}`}
    >
      <span className="rating-zero" />
      {value !== 0 && (
        <span
          className={`rating-fill marker-${tone}`}
          style={value < 0 ? { right: '50%', width: `${width}%` } : { left: '50%', width: `${width}%` }}
        />
      )}
    </span>
  );
}

function RecordingPlayer({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const ref = useRef<HTMLVideoElement>(null);
  useSinkId(ref, loadSettings().speakerId);

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    void loadVideo(id).then((blob) => {
      if (cancelled) return;
      if (!blob) return setState('missing');
      made = URL.createObjectURL(blob);
      setUrl(made);
      setState('ready');
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);

  return (
    <div className="video-frame report-video">
      {state === 'ready' && url ? (
        <video ref={ref} src={url} controls playsInline onLoadedMetadata={fixWebmDuration} />
      ) : (
        <div className="video-missing small">{state === 'loading' ? '' : 'Recording not available'}</div>
      )}
    </div>
  );
}
