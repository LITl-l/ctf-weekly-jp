import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/ctftime.json';
import { handleInteraction, type Interaction } from '../src/discord/interactions';
import type { Env } from '../src/types';

const env = {
  CONFIG: undefined,
  AI_BASE_URL: 'https://ai.example.com/v1',
  AI_MODEL: 'test-model',
  AI_API_KEY: 'test-key',
  CTFTIME_USER_AGENT: 'ctf-weekly-jp/test',
  DISCORD_WEBHOOK_URL: 'https://discord.example.com/webhook',
  DISCORD_PUBLIC_KEY: '',
  DISCORD_APP_ID: 'app-id',
} as unknown as Env;

const command = (name: string, options: ReadonlyArray<unknown> = []): Interaction =>
  ({
    type: 2,
    token: 'interaction-token',
    application_id: 'app-id',
    data: { name: 'ctf', options: [{ name, type: 1, options }] },
  }) as unknown as Interaction;

/** `/ctf config <sub>` nests one level deeper than `/ctf next`. */
const configCommand = (sub: string, options: ReadonlyArray<unknown> = []): Interaction =>
  command('config', [{ name: sub, type: 1, options }]);

/** Captures what `waitUntil` was handed so a test can await the deferred work. */
const collector = () => {
  const promises: Promise<unknown>[] = [];
  return { waitUntil: (promise: Promise<unknown>) => void promises.push(promise), promises };
};

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/** Routes CTFtime to the fixture, fails the AI, and records Discord traffic. */
const recordingFetch = (discord: (sent: Sent) => Response | Promise<Response>) => {
  const sent: Sent[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('ctftime.org')) return Response.json(fixture);
    if (!href.includes('discord.com')) return new Response('ai down', { status: 503 });

    const record = { url: href, method: init?.method ?? 'GET', body: String(init?.body ?? '') };
    sent.push(record);
    return discord(record);
  });
  return { fetchImpl: impl as unknown as typeof fetch, sent };
};

describe('handleInteraction', () => {
  it('answers Discord’s PING probe with a PONG', async () => {
    const response = await handleInteraction(
      { type: 1, token: 't', application_id: 'app-id' } as Interaction,
      env,
      collector(),
    );
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it('acknowledges /ctf next before the digest is anywhere near done', async () => {
    const stalled = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const ctx = collector();

    const response = await handleInteraction(command('next'), env, ctx, stalled);

    await expect(response.json()).resolves.toEqual({ type: 5 });
    expect(ctx.promises).toHaveLength(1);
    expect(stalled).toHaveBeenCalled();
  });

  it('edits the deferred placeholder with the digest', async () => {
    const { fetchImpl, sent } = recordingFetch(() => new Response(null, { status: 204 }));
    const ctx = collector();

    await handleInteraction(command('next'), env, ctx, fetchImpl);
    await ctx.promises[0];

    expect(sent[0]!.method).toBe('PATCH');
    expect(sent[0]!.url).toContain('/messages/@original');
    expect(sent[0]!.body).toContain('今週のCTF');
  });

  it('logs when Discord refuses the edit instead of failing silently', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchImpl } = recordingFetch(() => new Response('bad request', { status: 400 }));
    const ctx = collector();

    await handleInteraction(command('next'), env, ctx, fetchImpl);
    await expect(ctx.promises[0]).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('settles rather than rejecting when the follow-up call throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchImpl } = recordingFetch(() => {
      throw new Error('socket closed');
    });
    const ctx = collector();

    await handleInteraction(command('next'), env, ctx, fetchImpl);
    await expect(ctx.promises[0]).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('tells the user when the run itself fails, rather than spinning forever', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchImpl, sent } = recordingFetch(() => new Response(null, { status: 204 }));
    const broken = {
      ...env,
      get CONFIG(): never {
        throw new Error('binding missing');
      },
    } as unknown as Env;
    const ctx = collector();

    await handleInteraction(command('next'), broken, ctx, fetchImpl);
    await expect(ctx.promises[0]).resolves.toBeUndefined();

    expect(sent[0]!.method).toBe('PATCH');
    expect(sent[0]!.body).toContain('失敗');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('shows the config without a KV binding', async () => {
    const response = await handleInteraction(configCommand('show'), env, collector());
    const body = (await response.json()) as { data: { content: string } };
    expect(body.data.content).toContain('現在の設定');
  });

  it('says storage is unavailable instead of throwing on reset', async () => {
    const response = await handleInteraction(configCommand('reset'), env, collector());
    const body = (await response.json()) as { data: { content: string } };
    expect(body.data.content).toContain('設定を保存できません');
  });

  it('says storage is unavailable instead of throwing on set', async () => {
    const response = await handleInteraction(
      configCommand('set', [
        { name: 'key', type: 3, value: 'days' },
        { name: 'value', type: 3, value: '14' },
      ]),
      env,
      collector(),
    );
    const body = (await response.json()) as { data: { content: string } };
    expect(body.data.content).toContain('設定を保存できません');
  });
});
