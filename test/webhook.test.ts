import { describe, expect, it, vi } from 'vitest';
import { postMessages } from '../src/discord/webhook';
import type { DiscordMessage } from '../src/types';

const URL = 'https://discord.example.com/webhook';
const messages: ReadonlyArray<DiscordMessage> = [{ content: 'one' }, { content: 'two' }];

const rateLimited = (retryAfter: number) =>
  new Response(JSON.stringify({ retry_after: retryAfter }), { status: 429 });

describe('postMessages', () => {
  it('posts every message in order', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await postMessages(URL, messages, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).content,
    );
    expect(bodies).toEqual(['one', 'two']);
  });

  it('retries after a 429 and honours retry_after', async () => {
    const responses = [rateLimited(0.01), new Response(null, { status: 204 })];
    const fetchImpl = vi.fn(async () => responses.shift()!);

    const result = await postMessages(URL, [{ content: 'one' }], fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after repeated 429s and reports the failure', async () => {
    const fetchImpl = vi.fn(async () => rateLimited(0.01));
    const result = await postMessages(URL, [{ content: 'one' }], fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'http', status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-429 error', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 }));
    const result = await postMessages(URL, [{ content: 'one' }], fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'http', status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failure rather than posting the rest', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 500 }));
    const result = await postMessages(URL, messages, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure as a value', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket closed');
    });
    const result = await postMessages(URL, messages, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network');
  });
});
