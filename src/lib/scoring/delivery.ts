import rubric from '../../data/rubric.json';
import type { DeliveryMetrics, Transcript } from '../../types';

const LONG_PAUSE_SEC = 3;
// Below these, a rate would be dominated by noise (a one-word answer reads as "600 wpm").
const MIN_SPEECH_SEC_FOR_WPM = 0.5;
const MIN_SPEECH_MIN_FOR_FILLER_RATE = 0.05;

const WORD_RE = /[a-z0-9]+(?:'[a-z]+)?/g;
const TOKEN_RE = /[a-z0-9]+(?:'[a-z]+)?|[,.;:!?]/g;

/** Words that, directly before "like", make it a verb/comparison rather than a filler. */
const LIKE_FILLER_PREV = new Set([
  'was',
  'is',
  'were',
  'are',
  "it's",
  "that's",
  "there's",
  'and',
  'so',
  'but',
  'just',
  'then',
  'had',
  'got',
  'um',
  'uh',
  'er',
  'erm',
  'ah',
  'be',
  'been',
  'goes',
  'went',
  'said',
  'says',
  'all',
  'really',
  'very',
]);
const KIND_OF_BLOCK_PREV = new Set([
  'this',
  'that',
  'what',
  'some',
  'any',
  'a',
  'the',
  'of',
  'every',
  'different',
  'same',
  'other',
  'which',
  'whatever',
  'one',
  'each',
]);

const normalise = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'");

/** Lowercase words only, with curly apostrophes straightened. */
export function words(text: string): string[] {
  return normalise(text).match(WORD_RE) ?? [];
}

/** Lowercase words plus punctuation tokens (commas matter for "like," and "right?"). */
function tokenize(text: string): string[] {
  return normalise(text).match(TOKEN_RE) ?? [];
}

export function countWords(text: string): number {
  return words(text).length;
}

/** Whether this occurrence of a filler really is one ("I like to run" is not). */
function contextOk(filler: string, toks: string[], i: number, len: number): boolean {
  const prev = toks[i - 1];
  const next = toks[i + len];
  switch (filler) {
    case 'like':
      if (next === 'to') return false;
      if (prev === ',' || next === ',') return true;
      return (
        prev !== undefined && LIKE_FILLER_PREV.has(prev) && next !== 'a' && next !== 'an' && next !== 'the'
      );
    case 'right':
      return next === ',' || next === '?';
    case 'kind of':
    case 'sort of':
      return !(prev !== undefined && KIND_OF_BLOCK_PREV.has(prev));
    default:
      return true;
  }
}

export function detectFillers(text: string): { count: number; found: Record<string, number> } {
  const toks = tokenize(text);
  const fillers = (rubric.fillerWords as string[])
    .map((f) => ({ f, parts: f.split(' ') }))
    .sort((a, b) => b.parts.length - a.parts.length); // try "you know" before "you"
  const found: Record<string, number> = {};
  let count = 0;
  let i = 0;
  while (i < toks.length) {
    let matched = false;
    for (const { f, parts } of fillers) {
      const n = parts.length;
      let ok = true;
      for (let k = 0; k < n; k++)
        if (toks[i + k] !== parts[k]) {
          ok = false;
          break;
        }
      if (!ok) continue;
      if (!contextOk(f, toks, i, n)) continue;
      found[f] = (found[f] ?? 0) + 1;
      count++;
      i += n;
      matched = true;
      break;
    }
    if (!matched) i++;
  }
  return { count, found };
}

export function computeDelivery(
  transcript: Transcript,
  durationSec: number,
  maxSeconds: number,
): DeliveryMetrics {
  const text = transcript.text;
  const wordCount = countWords(text);
  const segs = transcript.segments.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end));

  // Prefer the span covered by the transcript segments over the recording length, so silence at
  // either end doesn't drag the pace down.
  let speechSec = durationSec;
  if (segs.length > 0) {
    const span = Math.max(...segs.map((s) => s.end)) - Math.min(...segs.map((s) => s.start));
    if (span > 1) speechSec = span;
  }
  if (!(speechSec > 0)) speechSec = transcript.durationSec > 0 ? transcript.durationSec : 0;
  const wpm = speechSec > MIN_SPEECH_SEC_FOR_WPM ? Math.round((wordCount / speechSec) * 60) : 0;

  const { count, found } = detectFillers(text);
  const minutes = speechSec / 60;
  const fillerRatePerMin =
    minutes > MIN_SPEECH_MIN_FOR_FILLER_RATE ? Math.round((count / minutes) * 10) / 10 : 0;

  const dur = durationSec > 0 ? durationSec : transcript.durationSec;
  const timeUsedPct = maxSeconds > 0 && dur > 0 ? Math.min(100, Math.round((dur / maxSeconds) * 100)) : 0;

  let longPauses = 0;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start - sorted[i - 1].end > LONG_PAUSE_SEC) longPauses++;
  }

  return {
    wordCount,
    wpm,
    fillerCount: count,
    fillerRatePerMin,
    fillersFound: found,
    timeUsedPct,
    longPauses,
  };
}
