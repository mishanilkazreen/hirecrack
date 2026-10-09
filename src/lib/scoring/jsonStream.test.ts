import { describe, expect, it } from 'vitest';
import { jsonCloseTracker } from './jsonStream';

describe('jsonCloseTracker', () => {
  it('reports the close of an object that started in the prefill', () => {
    const closes = jsonCloseTracker('{"a":{"r":');
    expect(closes('1,"s":2},')).toBe(false);
    expect(closes('"summary":"ok"')).toBe(false);
    expect(closes('}')).toBe(true);
  });

  it('ignores braces and quotes inside strings', () => {
    const closes = jsonCloseTracker('{');
    expect(closes('"summary":"use {braces} and \\"quotes\\" }"')).toBe(false);
    expect(closes('}\n\nNote: extra text')).toBe(true);
  });

  it('stays closed once the object is complete', () => {
    const closes = jsonCloseTracker('');
    expect(closes('{}')).toBe(true);
    expect(closes('{"more":1}')).toBe(true);
  });
});
