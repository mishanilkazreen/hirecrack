import { useEffect, useRef, useState } from 'react';
import CameraPreview from '../components/CameraPreview';
import DevicePicker from '../components/DevicePicker';
import EyeContactBadge from '../components/EyeContactBadge';
import { useGaze } from '../components/useGaze';
import { useMediaStream, useMicLevel } from '../lib/media';
import { preloadTranscriber } from '../lib/transcribe';
import type { GazeTracker, ProgressInfo, Settings } from '../types';

const TRACKER_POLL_MS = 300;

interface Props {
  settings: Settings;
  onSettings: (next: Settings) => void;
  onContinue: () => void;
  onBack: () => void;
}

export default function SetupCheck({ settings, onSettings, onContinue, onBack }: Props) {
  const { stream, error, loading } = useMediaStream(settings.cameraId, settings.micId);
  const level = useMicLevel(stream);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { trackerRef, live, error: gazeError } = useGaze(settings.enableGaze && !!stream);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);

  // The tracker loads asynchronously, so poll until it and the video are ready, then start it.
  useEffect(() => {
    if (!stream || !settings.enableGaze) return;
    const video = videoRef.current;
    let started: GazeTracker | null = null;
    const tryStart = () => {
      const tracker = trackerRef.current;
      if (started || !tracker || !video || video.readyState < 2) return;
      started = tracker;
      tracker.start(video);
    };
    const id = window.setInterval(tryStart, TRACKER_POLL_MS);
    return () => {
      window.clearInterval(id);
      started?.stop();
    };
  }, [stream, settings.enableGaze, trackerRef]);

  // Warm up the speech model now so the first submit isn't slow. Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    preloadTranscriber(settings, (p) => !cancelled && setProgress(p))
      .then(() => !cancelled && setModelReady(true))
      .catch((e) => !cancelled && setModelError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = progress?.progress != null ? Math.round(progress.progress * 100) : null;

  return (
    <section className="page narrow">
      <h2>Check your setup</h2>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : (
        <CameraPreview stream={stream} videoRef={videoRef}>
          {loading && <div className="video-overlay-center muted">Starting camera...</div>}
        </CameraPreview>
      )}

      {stream && (
        <div className="card stack">
          <DevicePicker granted value={settings} onChange={(ids) => onSettings({ ...settings, ...ids })} />
          <div>
            <span className="label" id="mic-label">
              Mic level
            </span>
            <div
              className="bar"
              role="meter"
              aria-labelledby="mic-label"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={level}
            >
              <div className="bar-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          </div>
          {settings.enableGaze && (
            <div>
              <span className="label">Eye contact</span>
              <div>
                {gazeError ? (
                  <span className="small muted">Eye-contact tracking unavailable: {gazeError}</span>
                ) : live ? (
                  <EyeContactBadge face={live.face} looking={live.looking} />
                ) : (
                  <span className="small muted">Starting face tracking...</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="small muted" aria-live="polite">
        {settings.transcription === 'local'
          ? modelError
            ? `Speech model could not be preloaded (${modelError}). It will retry when you submit an answer.`
            : modelReady
              ? 'Speech model ready.'
              : `Preparing the local speech model${progress ? ` (${progress.stage}${pct != null ? `, ${pct}%` : ''})` : ''}. The first run downloads about 100 MB and is cached afterwards.`
          : 'Transcription will use the OpenAI API.'}
      </p>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={onContinue} disabled={!!error}>
          Continue
        </button>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
