import { useCallback, useEffect, useRef, useState } from 'react';
import CameraPreview from '../components/CameraPreview';
import EyeContactBadge from '../components/EyeContactBadge';
import Timer, { formatClock } from '../components/Timer';
import { useGaze } from '../components/useGaze';
import { fixWebmDuration, startRecorder, useMediaStream, useObjectUrl, useSinkId } from '../lib/media';
import type { ActiveRecorder } from '../lib/media';
import { answerLimitSeconds } from '../lib/settings';
import type { GazeSummary, Question, Settings } from '../types';

export interface Take {
  blob: Blob;
  gaze: GazeSummary | null;
  durationSec: number;
  attemptsUsed: number;
}

interface Props {
  question: Question;
  settings: Settings;
  onSubmit: (take: Take) => void;
  onExit: () => void;
}

type Phase = 'prep' | 'recording' | 'stopping' | 'review';

const TRACKER_POLL_MS = 200;
// HTMLMediaElement.HAVE_CURRENT_DATA: a frame is available to draw or analyse.
const HAVE_CURRENT_DATA = 2;

export default function Interview({ question, settings, onSubmit, onExit }: Props) {
  const { stream, error, loading } = useMediaStream(settings.cameraId, settings.micId);
  const { trackerRef, live } = useGaze(settings.enableGaze);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const startedAt = useRef(0);
  const playbackRef = useRef<HTMLVideoElement | null>(null);

  const maxAttempts = Math.max(1, settings.maxAttempts);
  const answerSeconds = answerLimitSeconds(settings);
  const firstPhase: Phase = settings.prepSeconds > 0 ? 'prep' : 'recording';

  const [attempt, setAttempt] = useState(1);
  const [phase, setPhase] = useState<Phase>(firstPhase);
  const [take, setTake] = useState<Take | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const url = useObjectUrl(take?.blob ?? null);
  useSinkId(playbackRef, settings.speakerId);

  // Start the recorder once the phase is "recording" and the camera stream is ready.
  useEffect(() => {
    if (phase !== 'recording' || !stream || recorderRef.current) return;
    try {
      recorderRef.current = startRecorder(stream);
      startedAt.current = Date.now();
      setRecError(null);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : 'Recording is not supported here.');
      return;
    }
    if (settings.enableGaze) {
      // The tracker may still be loading, so poll until it and the video are ready.
      const id = window.setInterval(() => {
        const tracker = trackerRef.current;
        const video = videoRef.current;
        if (tracker && video && video.readyState >= HAVE_CURRENT_DATA) {
          window.clearInterval(id);
          tracker.start(video);
        }
      }, TRACKER_POLL_MS);
      return () => window.clearInterval(id);
    }
  }, [phase, stream, settings.enableGaze, trackerRef]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setPhase('stopping');
    const durationSec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const gaze = settings.enableGaze ? stopTracker(trackerRef.current) : null;
    const blob = await rec.stop();
    setTake({ blob, gaze, durationSec, attemptsUsed: attempt });
    setPhase('review');
  }, [attempt, settings.enableGaze, trackerRef]);

  // If the user leaves mid-recording, stop the recorder so the camera light goes off.
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      recorderRef.current = null;
      void rec?.stop();
    },
    [],
  );

  const retake = () => {
    setTake(null);
    setAttempt((a) => a + 1);
    setPhase(firstPhase);
  };

  const [confirmExit, setConfirmExit] = useState(false);
  // Leaving while recording loses the take, so ask first.
  const requestExit = () => {
    if (phase === 'recording' || phase === 'stopping' || phase === 'review') setConfirmExit(true);
    else onExit();
  };

  const attemptsLeft = maxAttempts - attempt;

  return (
    <section className="page">
      <header className="q-head">
        <button type="button" className="exit-btn" onClick={requestExit}>
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          Exit
        </button>
        <span className="small muted" aria-live="polite">
          Attempt {attempt} of {maxAttempts}
        </span>
      </header>
      {confirmExit && (
        <div className="alert confirm-bar" role="alertdialog" aria-label="Exit practice">
          <span>Exit and discard this answer?</span>
          <span className="row">
            <button type="button" className="btn btn-sm btn-danger" onClick={onExit} autoFocus>
              Exit
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirmExit(false)}>
              Keep going
            </button>
          </span>
        </div>
      )}
      <h2 className="question">{question.text}</h2>

      {error ? (
        <>
          <div className="alert alert-error" role="alert">
            {error}
          </div>
          <button type="button" className="btn" onClick={onExit}>
            Back
          </button>
        </>
      ) : (
        <>
          {phase !== 'review' && (
            <CameraPreview stream={stream} videoRef={videoRef}>
              {loading && <div className="video-overlay-center muted">Starting camera...</div>}
              {phase === 'recording' && (
                <>
                  <div className="rec-indicator">
                    <span className="rec-dot" aria-hidden="true" /> Recording
                  </div>
                  {settings.enableGaze && live && (
                    <div className="video-corner">
                      <EyeContactBadge face={live.face} looking={live.looking} />
                    </div>
                  )}
                </>
              )}
            </CameraPreview>
          )}

          {phase === 'prep' && (
            <div className="center stack">
              <p className="muted">Think about your answer. Recording starts automatically.</p>
              <Timer
                key={`prep-${attempt}`}
                seconds={settings.prepSeconds}
                large
                label="Preparation time left"
                onDone={() => setPhase('recording')}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPhase('recording')}
                disabled={!stream}
              >
                Start recording now
              </button>
            </div>
          )}

          {phase === 'recording' && (
            <div className="center stack">
              {recError && (
                <div className="alert alert-error" role="alert">
                  {recError}
                </div>
              )}
              <Timer
                key={`rec-${attempt}`}
                seconds={answerSeconds}
                large
                label="Answer time left"
                onDone={() => void stopRecording()}
              />
              <button type="button" className="btn btn-danger" onClick={() => void stopRecording()}>
                Stop
              </button>
            </div>
          )}

          {phase === 'stopping' && <p className="center muted">Finishing recording...</p>}

          {phase === 'review' && take && (
            <div className="stack">
              <div className="video-frame">
                {url && (
                  <video
                    ref={playbackRef}
                    src={url}
                    controls
                    playsInline
                    aria-label="Playback of your recorded answer"
                    onLoadedMetadata={fixWebmDuration}
                  />
                )}
              </div>
              <p className="small muted">Duration: {formatClock(take.durationSec)}</p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={() => onSubmit(take)}>
                  Submit this answer
                </button>
                <button type="button" className="btn" onClick={retake} disabled={attemptsLeft <= 0}>
                  Retake ({Math.max(0, attemptsLeft)} left)
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Missing eye-contact data shouldn't block submitting the answer.
function stopTracker(tracker: { stop(): GazeSummary } | null): GazeSummary | null {
  try {
    return tracker ? tracker.stop() : null;
  } catch {
    return null;
  }
}
