// Shared scoring maths, used by both the rules engine and the AI engines so their numbers are
// comparable: aspect ratings (-2..+2) -> weighted score (-100..100), plus a small delivery nudge.
import rubric from '../../data/rubric.json';
import type { AspectKey, AspectRating, AspectScore, DeliveryMetrics, Verdict } from '../../types';

/** Answers shorter than this are never sent to an AI engine and get a fixed "too short" result. */
export const MIN_WORDS_TO_SCORE = 15;

export const ASPECTS = rubric.aspects as { key: AspectKey; label: string; weight: number }[];
export const ASPECT_KEYS: AspectKey[] = ASPECTS.map((a) => a.key);

/** Delivery can move the score by at most this much in either direction. */
export const MAX_DELIVERY_NUDGE = 10;

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function toRating(n: unknown): AspectRating {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return clamp(Math.round(v), -2, 2) as AspectRating;
}

export function verdictFor(score: number): Verdict {
  if (score <= -50) return 'Very negative';
  if (score < -15) return 'Negative';
  if (score <= 15) return 'Neutral';
  if (score < 50) return 'Positive';
  return 'Very positive';
}

/** Weighted mean of the ratings, scaled so all +2 is 100 and all -2 is -100. */
export function aspectScore(ratings: Record<AspectKey, number>): number {
  const wsum = ASPECTS.reduce((a, x) => a + x.weight, 0) || 1;
  const mean = ASPECTS.reduce((a, x) => a + (ratings[x.key] ?? 0) * x.weight, 0) / wsum;
  return (mean / 2) * 100;
}

/** Small adjustment from pace, fillers and how much of the time was used. Range -10..+10. */
export function deliveryNudge(d: DeliveryMetrics): number {
  let n = 0;
  const [lo, hi] = rubric.idealWpm as [number, number];
  if (d.wpm > 0) {
    if (d.wpm >= lo - 10 && d.wpm <= hi + 10) n += 4;
    else if (d.wpm < lo - 40 || d.wpm > hi + 40) n -= 4;
  }
  if (d.wordCount >= MIN_WORDS_TO_SCORE) {
    if (d.fillerRatePerMin > 8) n -= 5;
    else if (d.fillerRatePerMin > 4) n -= 2;
    else if (d.fillerRatePerMin <= 2) n += 3;
  }
  if (d.timeUsedPct > 0 && d.timeUsedPct < 25) n -= 3;
  else if (d.timeUsedPct >= 50) n += 3;
  return clamp(n, -MAX_DELIVERY_NUDGE, MAX_DELIVERY_NUDGE);
}

/** Highest score allowed when an answer contains red flags: one is Negative, several Very negative. */
export function redFlagCap(count: number): number {
  if (count <= 0) return 100;
  return count === 1 ? -30 : -55;
}

/** The final -100..100 score: aspects, then the delivery nudge, then the red-flag cap. */
export function finalScore(
  ratings: Record<AspectKey, number>,
  delivery: DeliveryMetrics,
  redFlags: number,
): number {
  const raw = aspectScore(ratings) + deliveryNudge(delivery);
  const capped = Math.min(raw, redFlagCap(redFlags));
  return clamp(Math.round(capped), -100, 100);
}

export function ratingsOf(aspects: AspectScore[]): Record<AspectKey, number> {
  const out = {} as Record<AspectKey, number>;
  for (const k of ASPECT_KEYS) out[k] = aspects.find((a) => a.key === k)?.rating ?? 0;
  return out;
}
