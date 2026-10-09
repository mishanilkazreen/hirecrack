import { useEffect, useRef, useState } from 'react';

interface Props {
  seconds: number;
  onDone: () => void;
  large?: boolean;
  label?: string;
}

const WARN_AT_SEC = 10;
// Screen readers hear the time left at these marks only, not every tick.
const ANNOUNCE_AT_SEC = [10, 30];
const TICK_MS = 200;

/** Formats seconds as m:ss, rounding up so the clock never shows 0:00 while time remains. */
export function formatClock(total: number): string {
  const s = Math.max(0, Math.ceil(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Countdown that starts on mount. Remount (change `key`) to restart. */
export default function Timer({ seconds, onDone, large, label }: Props) {
  const [left, setLeft] = useState(seconds);
  // Keep the latest callback without restarting the countdown when the parent re-renders.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const end = Date.now() + seconds * 1000;
    let fired = false;
    const id = window.setInterval(() => {
      const remaining = (end - Date.now()) / 1000;
      setLeft(Math.max(0, remaining));
      if (remaining <= 0 && !fired) {
        fired = true;
        window.clearInterval(id);
        doneRef.current();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [seconds]);

  const warn = left <= WARN_AT_SEC;
  const secondsLeft = Math.ceil(left);
  return (
    <div
      className={`timer${large ? ' timer-large' : ''}${warn ? ' timer-warn' : ''}`}
      role="timer"
      aria-label={label}
    >
      <span aria-hidden="true">{formatClock(left)}</span>
      <span className="sr-only" aria-live="polite">
        {ANNOUNCE_AT_SEC.includes(secondsLeft) ? `${secondsLeft} seconds left` : ''}
      </span>
    </div>
  );
}
