import { describe, expect, it } from 'vitest';
import type { Transcript } from '../../types';
import { computeDelivery, countWords, detectFillers } from './delivery';

const transcript = (text: string, durationSec = 60, segments: Transcript['segments'] = []): Transcript => ({
  text,
  segments,
  durationSec,
  engine: 'test',
});

describe('countWords', () => {
  it('counts words, ignoring punctuation and keeping contractions whole', () => {
    expect(countWords("I don't know, really.")).toBe(4);
    expect(countWords('')).toBe(0);
  });
});

describe('detectFillers', () => {
  it('detects classic fillers', () => {
    const { count, found } = detectFillers('Um, I think, uh, we should go.');
    expect(count).toBe(2);
    expect(found).toEqual({ um: 1, uh: 1 });
  });

  it('matches multi-word fillers as one filler', () => {
    const { count, found } = detectFillers('We went there, you know, and it was fine.');
    expect(found['you know']).toBe(1);
    expect(count).toBe(1);
  });

  it('does not count "like" used as a verb or comparison', () => {
    expect(detectFillers('I like to work in teams.').count).toBe(0);
    expect(detectFillers('It looked like a good plan.').count).toBe(0);
    expect(detectFillers('I would like the chance to lead.').count).toBe(0);
  });

  it('counts "like" used as a filler', () => {
    expect(detectFillers('It was, like, really hard.').found.like).toBe(1);
  });

  it('does not count "kind of" in "this kind of" phrases', () => {
    expect(detectFillers('This kind of problem is common.').count).toBe(0);
    expect(detectFillers('It was kind of difficult.').found['kind of']).toBe(1);
  });

  it('only counts "right" as a filler in tag-question position', () => {
    expect(detectFillers('I turned right at the office.').count).toBe(0);
    expect(detectFillers('It worked, right? We shipped it.').found.right).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(detectFillers('UM, well.').found.um).toBe(1);
  });

  it('returns zero for empty text', () => {
    expect(detectFillers('')).toEqual({ count: 0, found: {} });
  });
});

describe('computeDelivery', () => {
  it('computes wpm from the duration when there are no segments', () => {
    const words = Array.from({ length: 120 }, () => 'word').join(' ');
    const d = computeDelivery(transcript(words), 60, 90);
    expect(d.wordCount).toBe(120);
    expect(d.wpm).toBe(120);
  });

  it('computes wpm from the segment span when available', () => {
    const words = Array.from({ length: 100 }, () => 'word').join(' ');
    const d = computeDelivery(transcript(words, 60, [{ start: 10, end: 50, text: words }]), 60, 90);
    expect(d.wpm).toBe(150); // 100 words in 40s
  });

  it('computes timeUsedPct and caps it at 100', () => {
    expect(computeDelivery(transcript('a b c'), 45, 90).timeUsedPct).toBe(50);
    expect(computeDelivery(transcript('a b c'), 200, 90).timeUsedPct).toBe(100);
    expect(computeDelivery(transcript('a b c'), 45, 0).timeUsedPct).toBe(0);
  });

  it('counts long pauses (>3s) between segments', () => {
    const segs = [
      { start: 0, end: 5, text: 'a' },
      { start: 6, end: 10, text: 'b' },
      { start: 15, end: 20, text: 'c' },
    ];
    expect(computeDelivery(transcript('a b c', 20, segs), 20, 90).longPauses).toBe(1);
  });

  it('reports filler rate per minute', () => {
    const d = computeDelivery(transcript('um uh um well that is it', 60), 60, 90);
    expect(d.fillerCount).toBe(3);
    expect(d.fillerRatePerMin).toBe(3);
  });

  it('handles an empty transcript', () => {
    const d = computeDelivery(transcript('', 0), 0, 90);
    expect(d).toMatchObject({ wordCount: 0, wpm: 0, fillerCount: 0, timeUsedPct: 0, longPauses: 0 });
  });
});
