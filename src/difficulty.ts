import type { CtftimeEvent, Difficulty, EventSummary } from './types';
import { isUnrated } from './filter';
import { plainText } from './text';

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  beginner: '🟢 初心者向け',
  intermediate: '🟡 中級',
  advanced: '🔴 上級',
  unknown: '⚪ 未評価',
};

export const DIFFICULTY_COLORS: Readonly<Record<Difficulty, number>> = {
  beginner: 0x2ecc71,
  intermediate: 0xf1c40f,
  advanced: 0xe74c3c,
  unknown: 0x95a5a6,
};

export const isDifficulty = (value: unknown): value is Difficulty =>
  value === 'beginner' || value === 'intermediate' || value === 'advanced' || value === 'unknown';

/**
 * Deterministic fallback used when the AI call fails or returns junk.
 * Weight is CTFtime's own rating of event calibre, so it is the best signal
 * available without reading the description. See ADR-0003 for the weight-0 rule.
 */
export const difficultyFromWeight = (event: CtftimeEvent): Difficulty => {
  if (isUnrated(event)) return 'unknown';
  if (event.weight < 25) return 'beginner';
  if (event.weight < 50) return 'intermediate';
  return 'advanced';
};

const REASONS: Readonly<Record<Difficulty, string>> = {
  beginner: 'CTFtimeの重みが低く、入門者でも手が出る問題が多い傾向です。',
  intermediate: 'CTFtimeの重みは中程度で、基礎が固まっていれば挑戦できます。',
  advanced: 'CTFtimeの重みが高く、上位陣が集まる難易度です。',
  unknown: 'CTFtime上で未評価のため難易度を判定できません（新規開催の可能性）。',
};

/** Rule-only summary: no translation, no category guess, just the honest facts. */
export const ruleSummary = (event: CtftimeEvent): EventSummary => {
  const difficulty = difficultyFromWeight(event);
  return {
    summaryJa: plainText(event.description, 300) || '説明はありません。',
    categories: [],
    difficulty,
    reasonJa: REASONS[difficulty],
    source: 'rule',
  };
};

export { truncate } from './text';
