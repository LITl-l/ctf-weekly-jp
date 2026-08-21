import { describe, expect, it } from 'vitest';
import fixture from './fixtures/ctftime.json';
import { buildEmbed, buildMessages, formatJstDateTime, translateFormat, translateRestriction } from '../src/render';
import { ruleSummary } from '../src/difficulty';
import type { CtftimeEvent, DiscordEmbed, DiscordMessage, EventSummary } from '../src/types';
import { makeEvent } from './support/event';

const events = fixture as unknown as CtftimeEvent[];
const window = { from: new Date('2026-08-18T00:00:00Z'), to: new Date('2026-08-25T00:00:00Z') };

/** Discord counts these fields together, summed across every embed in a message. */
const embedChars = (embed: DiscordEmbed): number =>
  (embed.title?.length ?? 0) +
  (embed.description?.length ?? 0) +
  (embed.footer?.text.length ?? 0) +
  (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0);

const messageChars = (message: DiscordMessage): number =>
  (message.embeds ?? []).reduce((total, embed) => total + embedChars(embed), 0);

const aiSummary = (overrides: Partial<EventSummary> = {}): EventSummary => ({
  summaryJa: '初心者向けのオンラインCTFです。',
  categories: ['web', 'crypto'],
  difficulty: 'beginner',
  reasonJa: '公式説明に入門者向けと明記されています。',
  source: 'ai',
  ...overrides,
});

/** Every free-text field long enough to reach its own cap. */
const OVERSIZED: Partial<CtftimeEvent> = {
  description: 'あ'.repeat(9000),
  format: 'F'.repeat(2000),
  restrictions: 'X'.repeat(2000),
  location: '場'.repeat(2000),
  url: `https://example.com/${'u'.repeat(2000)}`,
};

const OVERSIZED_SUMMARY = aiSummary({ summaryJa: 'い'.repeat(9000), reasonJa: 'う'.repeat(9000) });

describe('formatJstDateTime', () => {
  it('converts UTC to JST (+9)', () => {
    const formatted = formatJstDateTime(new Date('2026-08-19T08:00:00+00:00'));
    expect(formatted).toContain('8月19日');
    expect(formatted).toContain('17:00');
  });

  it('rolls over to the next day past 15:00 UTC', () => {
    expect(formatJstDateTime(new Date('2026-08-19T16:00:00+00:00'))).toContain('8月20日');
  });
});

describe('translate helpers', () => {
  it('renders the restriction vocabulary seen in live data', () => {
    expect(translateRestriction('Open')).toBe('誰でも参加可');
    expect(translateRestriction('Casual')).toContain('誰でも参加可');
    expect(translateRestriction('Prequalified')).toBe('予選通過者のみ');
  });

  it('passes unknown restrictions through rather than hiding them', () => {
    expect(translateRestriction('Something-New')).toBe('Something-New');
  });

  it('marks online vs onsite', () => {
    expect(translateFormat(makeEvent({ format: 'Jeopardy', onsite: false }))).toContain('オンライン');
    expect(translateFormat(makeEvent({ format: 'Jeopardy', onsite: true, location: '東京' }))).toContain('東京');
  });
});

describe('buildEmbed', () => {
  const event = events[0]!;

  it('shows 未評価 rather than 0 for unrated events', () => {
    const unrated = { ...event, weight: 0 };
    const embed = buildEmbed(unrated, ruleSummary(unrated));
    expect(embed.fields?.find((f) => f.name.includes('weight'))?.value).toBe('未評価');
  });

  it('labels AI estimates as such', () => {
    const embed = buildEmbed(event, aiSummary());
    expect(embed.footer?.text).toContain('AI');
    expect(embed.fields?.some((f) => f.name.includes('AI推定'))).toBe(true);
  });

  it('marks rule-based fallbacks differently so readers are not misled', () => {
    const embed = buildEmbed(event, ruleSummary(event));
    expect(embed.fields?.some((f) => f.name.includes('自動判定'))).toBe(true);
  });

  it('keeps every field within Discord limits', () => {
    const embed = buildEmbed({ ...event, ...OVERSIZED }, OVERSIZED_SUMMARY);
    expect(embed.title!.length).toBeLessThanOrEqual(256);
    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.name.length).toBeLessThanOrEqual(256);
    }
  });

  it('fits inside a whole message budget on its own', () => {
    expect(embedChars(buildEmbed({ ...event, ...OVERSIZED }, OVERSIZED_SUMMARY))).toBeLessThanOrEqual(6000);
  });
});

describe('buildMessages', () => {
  const many = (count: number): CtftimeEvent[] =>
    Array.from({ length: count }, (_, i) => ({ ...events[0]!, id: i }));

  const maxLengthSummaries = (count: number): EventSummary[] =>
    Array.from({ length: count }, () =>
      aiSummary({ summaryJa: 'い'.repeat(900), reasonJa: 'う'.repeat(300) }),
    );

  it('batches at 10 embeds per message and puts the header on the first', () => {
    const events25 = many(25);
    const messages = buildMessages(events25, events25.map(ruleSummary), window);

    expect(messages).toHaveLength(3);
    expect(messages[0]!.embeds).toHaveLength(10);
    expect(messages[2]!.embeds).toHaveLength(5);
    expect(messages[0]!.content).toContain('今週のCTF');
    expect(messages[1]!.content).toBeUndefined();
  });

  it('keeps each message inside the 6000-character embed budget', () => {
    for (const message of buildMessages(many(15), maxLengthSummaries(15), window)) {
      expect(messageChars(message)).toBeLessThanOrEqual(6000);
    }
  });

  it('carries every event when the budget forces extra messages', () => {
    const messages = buildMessages(many(15), maxLengthSummaries(15), window);

    expect(messages.flatMap((message) => message.embeds ?? [])).toHaveLength(15);
    expect(messages[0]!.content).toContain('今週のCTF');
  });

  it('says so explicitly when nothing matches, instead of posting nothing', () => {
    const messages = buildMessages([], [], window);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('条件に合うCTFはありませんでした');
    expect(messages[0]!.embeds).toBeUndefined();
  });

  it('counts beginner events in the header', () => {
    const three = events.slice(0, 3);
    const summaries = three.map(() => aiSummary());
    expect(buildMessages(three, summaries, window)[0]!.content).toContain('初心者向け **3件**');
  });
});
