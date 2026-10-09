import { useEffect, useRef, useState } from 'react';
import { createGazeTracker } from '../lib/gaze';
import type { GazeTracker } from '../types';

export interface LiveGaze {
  face: boolean;
  looking: boolean;
}

/** Creates a gaze tracker when enabled, exposes its live status, and disposes it on unmount or when disabled. */
export function useGaze(enabled: boolean) {
  const trackerRef = useRef<GazeTracker | null>(null);
  const [live, setLive] = useState<LiveGaze | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    createGazeTracker()
      .then((t) => {
        if (cancelled) return t.dispose();
        // Samples arrive ~15 times a second; only re-render when the status actually changes.
        t.onSample = (s) =>
          setLive((prev) =>
            prev && prev.face === s.faceDetected && prev.looking === s.lookingAtCamera
              ? prev
              : { face: s.faceDetected, looking: s.lookingAtCamera },
          );
        trackerRef.current = t;
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Eye-contact tracking is unavailable.');
      });
    return () => {
      cancelled = true;
      const t = trackerRef.current;
      trackerRef.current = null;
      if (t) {
        t.onSample = null;
        t.dispose();
      }
    };
  }, [enabled]);

  return { trackerRef, live, error };
}
