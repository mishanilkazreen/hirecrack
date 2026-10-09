import { describe, expect, it } from 'vitest';
import { isDegenerate } from './degenerate';

describe('isDegenerate', () => {
  it('flags the repeated "!" output of a GPU overflow', () => {
    expect(isDegenerate('!!!!!!!!!!!!!!!!!!!!!!!!')).toBe(true);
    expect(isDegenerate(' 1,"s":!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!')).toBe(true);
  });

  it('accepts normal JSON replies', () => {
    expect(isDegenerate(' 1,"s":-1,"j":0,"i":-1,"c":1},"summary":"You stayed on topic."}')).toBe(false);
  });

  it('ignores very short replies', () => {
    expect(isDegenerate('!!!')).toBe(false);
    expect(isDegenerate('')).toBe(false);
  });
});
