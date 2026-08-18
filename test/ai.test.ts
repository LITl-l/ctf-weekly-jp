import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency, parseSummary, summarizeEvent } from '../src/ai';
import { makeEvent } from './support/event';

const event = makeEvent({
  description: 'A beginner friendly CTF',
  weight: 0,
  duration: { days: 0, hours: 24 },
});

const ai = { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k' };

const aiResponse = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

const validJson = JSON.stringify({
  summary_ja: '初心者向けのCTFです。',
  categories: ['web', 'PWN', 'nonsense'],
  difficulty: 'beginner',
  reason_ja: '説明に beginner friendly とあります。',
});

describe('parseSummary', () => {
  it('accepts valid output and filters unknown categories', () => {
    const result = parseSummary(JSON.parse(validJson));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.difficulty).toBe('beginner');
    expect(result.value.categories).toEqual(['web', 'pwn']);
    expect(result.value.source).toBe('ai');
  });

  it.each([
    ['an invalid difficulty value', { summary_ja: 'x', difficulty: 'easy' }],
    ['a missing summary', { difficulty: 'beginner' }],
    ['a non-object', 'nope'],
    ['null', null],
  ])('returns a shape failure for %s', (_label, input) => {
    const result = parseSummary(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('shape');
  });
});

describe('summarizeEvent', () => {
  it('parses a well-formed response', async () => {
    const fetchImpl = vi.fn(async () => aiResponse(validJson));
    const summary = await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(summary.source).toBe('ai');
    expect(summary.summaryJa).toBe('初心者向けのCTFです。');
  });

  it('survives models that wrap JSON in code fences', async () => {
    const fetchImpl = vi.fn(async () => aiResponse('```json\n' + validJson + '\n```'));
    const summary = await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(summary.source).toBe('ai');
  });

  it('falls back to rules on an API error instead of dropping the event', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const summary = await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(summary.source).toBe('rule');
    expect(summary.difficulty).toBe('unknown');
  });

  it('falls back to rules on malformed JSON', async () => {
    const fetchImpl = vi.fn(async () => aiResponse('not json at all'));
    const summary = await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(summary.source).toBe('rule');
  });

  it('skips the network entirely when no API key is configured', async () => {
    const fetchImpl = vi.fn(async () => aiResponse(validJson));
    const summary = await summarizeEvent(event, { ...ai, apiKey: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(summary.source).toBe('rule');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends an OpenAI-compatible chat completion request', async () => {
    const fetchImpl = vi.fn(async () => aiResponse(validJson));
    await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('m');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toContain('(未評価)');
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20, 0]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});

describe('provider compatibility', () => {
  it('retries without response_format when the provider rejects it with 400', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return body.response_format
        ? new Response('unsupported parameter', { status: 400 })
        : aiResponse(validJson);
    });
    const summary = await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(summary.source).toBe('ai');
  });

  it('gives up after the retry rather than looping', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 400 }));
    const summary = await summarizeEvent(event, { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(summary.source).toBe('rule');
  });

  it('strips HTML out of the description before prompting', async () => {
    const fetchImpl = vi.fn(async () => aiResponse(validJson));
    await summarizeEvent(
      makeEvent({ description: '<b>Bold</b> &amp; brave' }),
      { ...ai, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content).toContain('Bold & brave');
    expect(body.messages[1].content).not.toContain('<b>');
  });
});
