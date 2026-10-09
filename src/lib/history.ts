import type { AttemptResult } from '../types';
import { clearVideos } from './videoStore';

const KEY = 'ivp.history.v2';
const MAX_SAVED_RESULTS = 50;

// Drops anything without the current evaluation shape.
function isCurrent(r: unknown): r is AttemptResult {
  const ev = (r as AttemptResult | null)?.evaluation;
  return !!ev && typeof ev.score === 'number' && Array.isArray(ev.points) && Array.isArray(ev.aspects);
}

export function loadHistory(): AttemptResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isCurrent) : [];
  } catch {
    return [];
  }
}

/** Saves the result newest-first, keeping the most recent 50. Only text is stored, never the recording (see videoStore). */
export function saveResult(result: AttemptResult): void {
  const list = [result, ...loadHistory().filter((r) => r.id !== result.id)].slice(0, MAX_SAVED_RESULTS);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage is full or blocked; history just won't persist.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
  void clearVideos();
}
