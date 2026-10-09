import { describe, expect, it } from 'vitest';
import type { AspectRating, Evaluation, ScoreInput } from '../../types';
import { buildAiEvaluation, extractJson, quoteInTranscript } from './parse';
import { findRedFlags, rulesScore } from './rules';
import { deliveryNudge, finalScore, verdictFor } from './score';

const input = (text: string, durationSec = 60): ScoreInput => ({
  question: {
    id: 'q1',
    text: 'Tell me about a time you had to work with a difficult teammate.',
    category: 'behavioral',
    competencies: ['teamwork', 'communication'],
  },
  transcript: { text, segments: [], durationSec, engine: 'test' },
  gaze: null,
  durationSec,
  maxSeconds: 90,
});

const STRONG =
  'Last spring on my team project, one teammate kept missing deadlines and the rest of us were frustrated. ' +
  'I asked him for a quiet coffee and listened to what was going on, and it turned out he was working night shifts. ' +
  'I split the work so his tasks were smaller, set up a shared tracker, and agreed weekly check-ins with him. ' +
  'As a result we delivered the project two days early and our final mark improved by 12 percent. ' +
  'He later thanked me, and we worked together again on the next module, which taught me to ask before assuming.';

const VAGUE =
  'I think teamwork is really important. I am a hard worker and a team player and I am passionate about working with people. ' +
  'In general I always try my best and I believe that communication is key in everything that we do in life.';

describe('rulesScore', () => {
  it('scores a strong concrete answer positive, with positive points quoting the answer', () => {
    const ev = rulesScore(input(STRONG));
    expect(ev.score).toBeGreaterThan(15);
    expect(['Positive', 'Very positive']).toContain(ev.verdict);
    expect(ev.source).toBe('rules');
    expect(ev.betterAnswer).toBeUndefined();
    const pos = ev.points.filter((p) => p.kind === 'positive');
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) expect(STRONG).toContain(p.quote);
  });

  it('scores a vague answer at or below neutral, with negative points', () => {
    const ev = rulesScore(input(VAGUE));
    expect(ev.score).toBeLessThanOrEqual(15);
    expect(ev.aspects.find((a) => a.key === 'substance')!.rating).toBeLessThan(0);
    expect(ev.points.some((p) => p.kind === 'negative')).toBe(true);
  });

  it('puts an admission of scamming at Negative or worse, with a red flag quote', () => {
    const text =
      'I scam people when I get the chance because it is easy money. ' +
      'Last year I worked on a big group project, I planned the schedule, wrote the report, and we got 90 percent. ' +
      'As a result the team did very well and I built the final presentation too.';
    const ev = rulesScore(input(text));
    expect(['Negative', 'Very negative']).toContain(ev.verdict);
    expect(ev.score).toBeLessThan(-15);
    const rf = ev.points.filter((p) => p.kind === 'red_flag');
    expect(rf.length).toBeGreaterThan(0);
    expect(rf[0].quote).toContain('I scam people');
    expect(rf[0].suggestion).toBeTruthy();
    expect(ev.aspects.find((a) => a.key === 'judgement')!.rating).toBe(-2);
    expect(ev.points[0].kind).toBe('red_flag');
  });

  it('flags lying to a manager even inside an otherwise good answer', () => {
    const text = STRONG + ' Honestly I lied to my manager about it at the time so nobody would find out.';
    const ev = rulesScore(input(text));
    expect(ev.points.some((p) => p.kind === 'red_flag' && /lied to my manager/.test(p.quote))).toBe(true);
    expect(ev.score).toBeLessThan(-15);
  });

  it('does not flag negated or third-party statements', () => {
    expect(findRedFlags('I would never lie to a customer, and I never stole anything.')).toHaveLength(0);
    expect(findRedFlags('I reported a colleague who was stealing from the till.')).toHaveLength(0);
  });

  it('flags the other categories of red flag', () => {
    const cases = [
      'I do not care about the other people on the team.',
      'I am only here for the money to be honest.',
      'My manager was an idiot and it was all their fault.',
      'I came to work drunk once and nobody noticed.',
      'I broke the safety rules to finish faster.',
      'Women are not good at leading teams.',
      'I punched him because he annoyed me.',
    ];
    for (const c of cases) expect(findRedFlags(c).length, c).toBeGreaterThan(0);
  });

  it('gives an empty answer Negative with a clear point', () => {
    const ev = rulesScore(input(''));
    expect(ev.verdict).toBe('Negative');
    expect(ev.score).toBeLessThan(0);
    expect(ev.points[0].comment).toMatch(/no speech/i);
  });

  it('gives a one-line answer Negative', () => {
    const ev = rulesScore(input('Um, I would just talk to them.'));
    expect(ev.verdict).toBe('Negative');
  });

  it('keeps scores in bounds and aspects in key order', () => {
    for (const t of [
      STRONG,
      VAGUE,
      '',
      'word '.repeat(300),
      'I scam people. I stole. I lied to my boss. I hate my team.',
    ]) {
      const ev = rulesScore(input(t));
      expect(ev.score).toBeGreaterThanOrEqual(-100);
      expect(ev.score).toBeLessThanOrEqual(100);
      expect(ev.aspects.map((a) => a.key)).toEqual([
        'relevance',
        'substance',
        'judgement',
        'impact',
        'clarity',
      ]);
      for (const a of ev.aspects) expect([-2, -1, 0, 1, 2]).toContain(a.rating);
    }
  });

  it('never uses em dashes in feedback', () => {
    const ev = rulesScore(input(VAGUE));
    const all = JSON.stringify(ev);
    expect(all).not.toMatch(/[—–]/);
  });
});

describe('score maths', () => {
  const delivery = rulesScore(input(STRONG)).delivery;

  it('maps verdict thresholds as documented in types.ts', () => {
    expect(verdictFor(-100)).toBe('Very negative');
    expect(verdictFor(-50)).toBe('Very negative');
    expect(verdictFor(-49)).toBe('Negative');
    expect(verdictFor(-16)).toBe('Negative');
    expect(verdictFor(-15)).toBe('Neutral');
    expect(verdictFor(0)).toBe('Neutral');
    expect(verdictFor(15)).toBe('Neutral');
    expect(verdictFor(16)).toBe('Positive');
    expect(verdictFor(49)).toBe('Positive');
    expect(verdictFor(50)).toBe('Very positive');
    expect(verdictFor(100)).toBe('Very positive');
  });

  it('maps extreme ratings to the ends of the range, and a red flag caps the score', () => {
    const all = (n: AspectRating) => ({ relevance: n, substance: n, judgement: n, impact: n, clarity: n });
    const flat = { ...delivery, wpm: 0, fillerRatePerMin: 3, timeUsedPct: 0, wordCount: 0 };
    expect(finalScore(all(2), flat, 0)).toBe(100);
    expect(finalScore(all(-2), flat, 0)).toBe(-100);
    expect(finalScore(all(0), flat, 0)).toBe(0);
    expect(finalScore(all(2), flat, 1)).toBeLessThan(-15);
    expect(finalScore(all(2), flat, 2)).toBeLessThanOrEqual(-50);
  });

  it('limits the delivery nudge to 10 points either way', () => {
    const good = { ...delivery, wpm: 140, fillerRatePerMin: 0, timeUsedPct: 90 };
    const bad = { ...delivery, wpm: 300, fillerRatePerMin: 20, timeUsedPct: 10 };
    expect(Math.abs(deliveryNudge(good))).toBeLessThanOrEqual(10);
    expect(Math.abs(deliveryNudge(bad))).toBeLessThanOrEqual(10);
    expect(deliveryNudge(good)).toBeGreaterThan(0);
    expect(deliveryNudge(bad)).toBeLessThan(0);
  });
});

describe('extractJson', () => {
  it('parses plain JSON, code fences and surrounding junk', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here you go:\n{"a":{"b":"x } y"}} hope that helps')).toEqual({
      a: { b: 'x } y' },
    });
    expect(extractJson('<think>{"no":1}</think>{"a":4}')).toEqual({ a: 4 });
    expect(extractJson('junk {not json} then {"a":5}')).toEqual({ a: 5 });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('AI output validation', () => {
  const text = STRONG;
  const rules = rulesScore(input(text));
  const build = (json: unknown, t = text) =>
    buildAiEvaluation(json, { input: input(t), delivery: rules.delivery, rules, model: 'test:m' });
  const aspects = (n: number) =>
    Object.fromEntries(
      ['relevance', 'substance', 'judgement', 'impact', 'clarity'].map((k) => [
        k,
        { rating: n, comment: 'c' },
      ]),
    );

  it('matches quotes ignoring case, whitespace and punctuation', () => {
    expect(quoteInTranscript('as a  RESULT we delivered the project two days early', text)).toBe(true);
    expect(quoteInTranscript('we shipped the project three weeks late', text)).toBe(false);
  });

  it('drops invented positive and red-flag quotes and blanks invented negative quotes', () => {
    const ev = build({
      aspects: aspects(1),
      points: [
        { kind: 'positive', quote: 'I saved the company a million pounds', comment: 'x' },
        { kind: 'red_flag', quote: 'I lied to everyone', comment: 'x' },
        { kind: 'negative', quote: 'a made up sentence here', comment: 'weak', suggestion: 'fix' },
        {
          kind: 'positive',
          quote: 'I split the work so his tasks were smaller',
          comment: 'Concrete action.',
        },
      ],
      summary: 'Fine answer.',
    });
    expect(ev.points.map((p) => p.kind)).toEqual(['negative', 'positive']);
    expect(ev.points[0].quote).toBe('');
    expect(ev.points[1].quote).toBe('I split the work so his tasks were smaller');
  });

  it('computes the score from aspects, clamps ratings and orders points', () => {
    const ev = build({
      aspects: { ...aspects(5), clarity: { rating: -9, comment: 'bad' } },
      points: [
        { kind: 'positive', quote: 'I asked him for a quiet coffee', comment: 'Good.' },
        { kind: 'negative', quote: '', comment: 'No numbers on the team size.', suggestion: 'Add one.' },
      ],
      summary: 'Good.',
      better_answer: 'Start with the deadline problem.',
    });
    expect(ev.aspects.find((a) => a.key === 'clarity')!.rating).toBe(-2);
    expect(ev.aspects.find((a) => a.key === 'relevance')!.rating).toBe(2);
    expect(ev.score).toBeLessThanOrEqual(100);
    expect(ev.score).toBeGreaterThan(50);
    expect(ev.points.map((p) => p.kind)).toEqual(['negative', 'positive']);
    expect(ev.source).toBe('ai');
    expect(ev.model).toBe('test:m');
    expect(ev.betterAnswer).toContain('deadline');
  });

  it('forces judgement to -2 and caps the score when a valid red flag is present', () => {
    const t = 'I scam people for fun but I also planned our team project and we finished it two days early.';
    const ev = build(
      {
        aspects: aspects(2),
        points: [
          {
            kind: 'red_flag',
            quote: 'I scam people for fun',
            comment: 'Admits fraud.',
            suggestion: 'Pick another story.',
          },
        ],
        summary: 's',
      },
      t,
    );
    expect(ev.aspects.find((a) => a.key === 'judgement')!.rating).toBe(-2);
    expect(['Negative', 'Very negative']).toContain(ev.verdict);
  });

  it('adds obvious rule-based red flags the model missed', () => {
    const t =
      'I lied to my manager about the numbers and then fixed the report the next day with the finance team.';
    const ev = build({ aspects: aspects(2), points: [], summary: 's' }, t);
    expect(ev.points.some((p) => p.kind === 'red_flag')).toBe(true);
    expect(ev.score).toBeLessThan(-15);
  });

  it('rejects non-object output', () => {
    expect(() => build('nope')).toThrow();
  });

  it('strips em dashes from model text', () => {
    const ev = build({ aspects: aspects(0), points: [], summary: 'Good — but vague.' }) as Evaluation;
    expect(ev.summary).not.toMatch(/—/);
  });
});

describe('red flag phrasings', () => {
  const flagged = [
    'Honestly I cheated on the final exam.',
    'I stole some stationery from the office once.',
    'We lied to the customer about the delivery date.',
    'I got it done without my manager knowing.',
    'I shouted at a customer and walked out.',
    'I hated my last manager and everyone there.',
    'That was entirely their fault, not mine.',
    'I only applied for the money.',
    'I just do the bare minimum to get by.',
    'I shared confidential files with a friend.',
    'I ignored the safety procedures because they were slow.',
  ];
  it.each(flagged)('flags: %s', (text) => {
    expect(findRedFlags(text).length).toBeGreaterThan(0);
  });

  const fine = [
    'I never cheated, and I always followed the safety rules.',
    'My manager was supportive and taught me a lot.',
    'A colleague shouted at a customer and I calmed things down.',
    'I care a lot about getting the details right.',
    'I followed the company policy and escalated the issue.',
  ];
  it.each(fine)('does not flag: %s', (text) => {
    expect(findRedFlags(text)).toHaveLength(0);
  });

  it('returns at most one hit per sentence', () => {
    expect(findRedFlags('I lied and I cheated and I stole.')).toHaveLength(1);
  });

  it('keeps the whole sentence as the quote', () => {
    const [hit] = findRedFlags('We did well. I stole from the till last year. Then I left.');
    expect(hit.id).toBe('theft');
    expect(hit.sentence).toContain('I stole from the till');
  });
});
