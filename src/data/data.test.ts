import { describe, expect, it } from 'vitest';
import type { Competency, Question, QuestionCategory } from '../types';
import questionsJson from './questions.json';
import rubric from './rubric.json';

const questions = questionsJson as Question[];

// Mirror the unions in src/types.ts (these Records fail to compile if the unions change).
const CATEGORIES: Record<QuestionCategory, true> = {
  behavioral: true,
  situational: true,
  motivational: true,
  graduate: true,
  customer: true,
  technical: true,
};
const COMPETENCIES: Record<Competency, true> = {
  teamwork: true,
  problem_solving: true,
  communication: true,
  adaptability: true,
  drive: true,
  customer_focus: true,
  leadership: true,
  integrity: true,
};

describe('questions.json', () => {
  it('has questions', () => {
    expect(questions.length).toBeGreaterThan(0);
  });

  it('has unique ids and non-empty text', () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of questions) {
      expect(q.id).toMatch(/\S/);
      expect(q.text.trim().length).toBeGreaterThan(10);
    }
  });

  it('uses only valid categories and competencies, with at least one competency', () => {
    for (const q of questions) {
      expect(CATEGORIES, `${q.id} category`).toHaveProperty(q.category);
      expect(q.competencies.length, `${q.id} competencies`).toBeGreaterThan(0);
      for (const c of q.competencies) expect(COMPETENCIES, `${q.id} competency`).toHaveProperty(c);
    }
  });
});

describe('rubric.json', () => {
  it('has a lexicon entry for every competency, and no unknown ones', () => {
    const lex = rubric.competencyLexicon as Record<string, string[]>;
    for (const c of Object.keys(COMPETENCIES)) expect(lex[c]?.length, c).toBeGreaterThan(0);
    for (const c of Object.keys(lex)) expect(COMPETENCIES, c).toHaveProperty(c);
  });

  it('has lowercase filler words and a sane ideal WPM range', () => {
    for (const f of rubric.fillerWords) expect(f).toBe(f.toLowerCase());
    const [lo, hi] = rubric.idealWpm;
    expect(lo).toBeLessThan(hi);
  });

  it('has one aspect per key, with weights in (0, 1]', () => {
    const keys = rubric.aspects.map((a) => a.key);
    expect(keys).toEqual(['relevance', 'substance', 'judgement', 'impact', 'clarity']);
    for (const a of rubric.aspects) {
      expect(a.weight).toBeGreaterThan(0);
      expect(a.weight).toBeLessThanOrEqual(1);
    }
  });

  it('has red flags with unique ids and compilable patterns', () => {
    const ids = rubric.redFlags.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of rubric.redFlags) {
      expect(f.suggestion.length, f.id).toBeGreaterThan(10);
      expect(f.patterns.length, f.id).toBeGreaterThan(0);
      for (const p of f.patterns) expect(() => new RegExp(p, 'i'), p).not.toThrow();
    }
  });
});
