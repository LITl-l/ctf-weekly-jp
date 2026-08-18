import { describe, expect, it } from 'vitest';
import { difficultyFromWeight, isDifficulty, ruleSummary, truncate } from '../src/difficulty';
import type { CtftimeEvent } from '../src/types';
import { makeEvent } from './support/event';

const event = (weight: number, description = 'x'): CtftimeEvent =>
  makeEvent({ weight, description });

describe('difficultyFromWeight', () => {
  it('treats weight 0 as unrated, never as beginner', () => {
    expect(difficultyFromWeight(event(0))).toBe('unknown');
  });

  it.each([
    [1, 'beginner'],
    [24.99, 'beginner'],
    [25, 'intermediate'],
    [49.99, 'intermediate'],
    [50, 'advanced'],
    [99, 'advanced'],
  ])('maps weight %s to %s', (weight, expected) => {
    expect(difficultyFromWeight(event(weight))).toBe(expected);
  });
});

describe('ruleSummary', () => {
  it('marks itself as rule-sourced and explains an unrated event honestly', () => {
    const summary = ruleSummary(event(0));
    expect(summary.source).toBe('rule');
    expect(summary.difficulty).toBe('unknown');
    expect(summary.reasonJa).toContain('未評価');
  });

  it('falls back to a placeholder when there is no description', () => {
    expect(ruleSummary(event(10, '')).summaryJa).toBe('説明はありません。');
  });
});

describe('isDifficulty', () => {
  it('accepts known values and rejects anything else', () => {
    expect(isDifficulty('beginner')).toBe(true);
    expect(isDifficulty('easy')).toBe(false);
    expect(isDifficulty(undefined)).toBe(false);
  });
});

describe('truncate', () => {
  it('leaves short text alone and ellipsises long text', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 5)).toBe('abcd…');
  });
});
