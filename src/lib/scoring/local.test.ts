import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoreInput } from '../../types';
import { DEFAULT_SETTINGS } from '../settings';
import { extractJson, buildAiEvaluation } from './parse';
import { rulesScore } from './rules';

const gen = vi.fn();
vi.mock('./llm', () => ({
  generateLocal: (...a: unknown[]) => gen(...a),
  loadLocalModel: vi.fn(),
}));
const { scoreAnswer } = await import('./index');

const ANSWER =
  'Last spring on my team project, one teammate kept missing deadlines and the rest of us were frustrated. ' +
  'I asked him for a quiet coffee and listened to what was going on, and it turned out he was working night shifts. ' +
  'I split the work so his tasks were smaller and we delivered the project two days early.';

const input = (text = ANSWER): ScoreInput => ({
  question: {
    id: 'q1',
    text: 'Tell me about a difficult teammate.',
    category: 'behavioral',
    competencies: [],
  },
  transcript: { text, segments: [], durationSec: 60, engine: 'test' },
  gaze: null,
  durationSec: 60,
  maxSeconds: 90,
});

const local = { ...DEFAULT_SETTINGS, scoring: 'local' as const };

// What the model emits after the prefill `{"a":{"r":` is added back by generateLocal.
const PRE = '{"a":{"r":';
const GOOD_TAIL =
  '2,"s":1,"j":2,"i":1,"c":1},"summary":"Solid answer.","m":{"r":"On topic."},"p":[{"kind":"positive","quote":"delivered the project two days early","comment":"Concrete result."}],"better_answer":"Keep the coffee story."}';

const cases: Record<string, string> = {
  prefilled_good: PRE + GOOD_TAIL,
  truncated_mid_string: PRE + '2,"s":1,"j":2,"i":1,"c":1},"summary":"Solid answer. You also sho',
  truncated_mid_array:
    PRE +
    '2,"s":1,"j":2,"i":1,"c":1},"summary":"Solid.","p":[{"kind":"positive","quote":"delivered the project two days early","comment":"Concrete result."},{"kind":"neg',
  truncated_dangling_key: PRE + '2,"s":1,"j":2,"i":1,"c":1},"summary":"Solid.","p":[],"better_answer":',
  truncated_in_ratings: PRE + '2,"s":1,"j":',
  placeholder_kind:
    PRE +
    '2,"s":1,"j":2,"i":1,"c":1},"summary":"Solid.","p":[{"kind":"positive|negative|red_flag","quote":"delivered the project two days early","comment":"Concrete result.","suggestion":""}]}',
  trailing_commas:
    PRE +
    '2,"s":1,"j":2,"i":1,"c":1,},"summary":"Solid.","p":[{"kind":"positive","quote":"delivered the project two days early","comment":"Good.",},],}',
  preamble_and_fence:
    'Sure! Here is the JSON:\n```json\n{"a":{"r":2,"s":1,"j":2,"i":1,"c":1},"summary":"Solid."}\n```\nHope that helps.',
  single_quotes: "{'a':{'r':2,'s':1,'j':2,'i':1,'c':1},'summary':'It's solid.'}",
  smart_quotes: '{“a”:{“r”:2,“s”:1,“j”:2,“i”:1,“c”:1},“summary”:“Solid.”}',
  raw_newline_and_inner_quote:
    PRE + '2,"s":1,"j":2,"i":1,"c":1},"summary":"You said "coffee" helped.\nGood story."}',
  missing_fields: '{"a":{"r":2,"s":1},"summary":"Solid."}',
  full_schema_names:
    '{"aspects":{"relevance":{"rating":2,"comment":"ok"},"clarity":{"rating":-1,"comment":"meh"}},"summary":"x"}',
  think_block: '<think>hmm</think>' + PRE + GOOD_TAIL,
};

describe('lenient local parsing', () => {
  for (const [name, raw] of Object.entries(cases)) {
    it(`recovers an evaluation from: ${name}`, () => {
      const rules = rulesScore(input());
      const ev = buildAiEvaluation(extractJson(raw), {
        input: input(),
        delivery: rules.delivery,
        rules,
        model: 'local:x',
      });
      expect(ev.source).toBe('ai');
      expect(ev.aspects).toHaveLength(5);
      expect(ev.aspects.every((a) => a.rating >= -2 && a.rating <= 2)).toBe(true);
      expect(ev.points.length).toBeGreaterThan(0);
      expect(ev.summary.length).toBeGreaterThan(0);
      expect(Number.isFinite(ev.score)).toBe(true);
    });
  }

  it('keeps ratings from a reply that is cut off mid-ratings', () => {
    const v = extractJson(cases.truncated_in_ratings) as { a: Record<string, number> };
    expect(v.a).toEqual({ r: 2, s: 1 });
  });

  it('does not turn a placeholder kind into a red flag', () => {
    const rules = rulesScore(input());
    const ev = buildAiEvaluation(extractJson(cases.placeholder_kind), {
      input: input(),
      delivery: rules.delivery,
      rules,
      model: 'local:x',
    });
    expect(ev.points.some((p) => p.kind === 'red_flag')).toBe(false);
  });

  it('maps kinds loosely and clamps ratings', () => {
    const rules = rulesScore(input());
    const ev = buildAiEvaluation(
      extractJson(
        '{"a":{"r":9,"s":-7,"j":"1","i":0,"c":2},"p":[{"kind":"Red Flag!","quote":"kept missing deadlines","comment":"x"}]}',
      ),
      { input: input(), delivery: rules.delivery, rules, model: 'local:x' },
    );
    expect(ev.aspects.map((a) => a.rating)).toEqual([2, -2, -2, 0, 2]);
    expect(ev.points[0].kind).toBe('red_flag');
  });

  it('throws only when no ratings are recoverable', () => {
    const rules = rulesScore(input());
    const o = { input: input(), delivery: rules.delivery, rules, model: 'local:x' };
    expect(() => buildAiEvaluation(extractJson('{"summary":"hi"}'), o)).toThrow();
    expect(() => extractJson('no json here')).toThrow(/valid JSON/);
  });
});

describe('scoreAnswer with the local model', () => {
  beforeEach(() => gen.mockReset());

  it('uses a truncated first reply without retrying', async () => {
    gen.mockResolvedValue(cases.truncated_mid_string);
    const ev = await scoreAnswer(input(), local);
    expect(ev.source).toBe('ai');
    expect(ev.warning).toBeUndefined();
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen.mock.calls[0][4].prefill).toBe(PRE);
  });

  it('retries once with the ratings-only prompt when the first reply is junk', async () => {
    gen
      .mockResolvedValueOnce('I cannot help with that')
      .mockResolvedValueOnce(PRE + '1,"s":0,"j":1,"i":0,"c":1},"summary":"Fine."}');
    const ev = await scoreAnswer(input(), local);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1][4].maxNewTokens).toBeLessThan(500);
    expect(ev.source).toBe('ai');
    expect(ev.summary).toBe('Fine.');
    expect(ev.points.length).toBeGreaterThan(0);
  });

  it('falls back to rules with a short plain warning when both attempts fail', async () => {
    gen.mockResolvedValue('nope');
    const ev = await scoreAnswer(input(), local);
    expect(ev.source).toBe('rules');
    expect(ev.warning).toMatch(/^AI scoring failed \(local\): .+Showing the built-in rules score instead\.$/);
    expect(ev.warning).not.toMatch(/[—–]/);
  });
});
