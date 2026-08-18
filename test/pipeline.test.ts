import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/ctftime.json';
import { runDigest } from '../src/pipeline';
import { DEFAULT_CONFIG } from '../src/config';
import type { Env } from '../src/types';

const env = {
  CONFIG: undefined,
  AI_BASE_URL: 'https://ai.example.com/v1',
  AI_MODEL: 'test-model',
  AI_API_KEY: 'test-key',
  CTFTIME_USER_AGENT: 'ctf-weekly-jp/test',
  DISCORD_WEBHOOK_URL: 'https://discord.example.com/webhook',
  DISCORD_PUBLIC_KEY: '',
  DISCORD_APP_ID: '',
} as unknown as Env;

const now = new Date('2026-08-18T00:00:00Z');

/** Routes CTFtime to the fixture and lets each test decide how the AI behaves. */
function makeFetch(aiHandler: (url: string) => Response, ctftime: Response = Response.json(fixture)) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    return href.includes('ctftime.org') ? ctftime.clone() : aiHandler(href);
  }) as unknown as typeof fetch;
}

const aiOk = () =>
  Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary_ja: 'テスト用の要約です。',
            categories: ['web'],
            difficulty: 'beginner',
            reason_ja: 'テスト理由。',
          }),
        },
      },
    ],
  });

describe('runDigest', () => {
  it('produces Japanese messages from live-shaped data', async () => {
    const result = await runDigest(env, { now, fetchImpl: makeFetch(aiOk), config: DEFAULT_CONFIG });

    expect(result.failure).toBeUndefined();
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.summaries.every((summary) => summary.source === 'ai')).toBe(true);
    expect(result.messages[0]!.content).toContain('今週のCTF');
    // 15 events exceed Discord's 10-embed cap, so they span two messages.
    const embedCount = result.messages.reduce((sum, m) => sum + (m.embeds?.length ?? 0), 0);
    expect(embedCount).toBe(result.events.length);
    expect(result.messages[0]!.embeds!.length).toBeLessThanOrEqual(10);
  });

  it('sends the User-Agent CTFtime requires', async () => {
    const fetchImpl = makeFetch(aiOk);
    await runDigest(env, { now, fetchImpl, config: DEFAULT_CONFIG });
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('ctf-weekly-jp/test');
  });

  it('still posts a digest when the AI is down, using rule-based difficulty', async () => {
    const fetchImpl = makeFetch(() => new Response('down', { status: 503 }));
    const result = await runDigest(env, { now, fetchImpl, config: DEFAULT_CONFIG });

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.summaries.every((summary) => summary.source === 'rule')).toBe(true);
    expect(result.messages[0]!.embeds![0]!.footer!.text).toContain('自動判定');
  });

  it('reports a CTFtime outage in the channel rather than failing silently', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const result = await runDigest(env, { now, fetchImpl, config: DEFAULT_CONFIG });

    expect(result.failure).toEqual({ kind: 'http', status: 403 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.content).toContain('取得できませんでした');
  });

  it('says nothing matched rather than posting an empty digest', async () => {
    const fetchImpl = makeFetch(aiOk, Response.json([]));
    const result = await runDigest(env, { now, fetchImpl, config: DEFAULT_CONFIG });
    expect(result.messages[0]!.content).toContain('条件に合うCTFはありませんでした');
  });

  it('honours a narrowed config', async () => {
    const fetchImpl = makeFetch(aiOk);
    const result = await runDigest(env, {
      now,
      fetchImpl,
      config: { ...DEFAULT_CONFIG, maxEvents: 2 },
    });
    expect(result.events).toHaveLength(2);
  });
});
