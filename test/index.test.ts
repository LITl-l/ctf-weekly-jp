import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { makeKeypair, signedRequest } from './support/signing';

/** Signed "now", because the worker rejects a stale signature. */
const TIMESTAMP = String(Math.floor(Date.now() / 1000));

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const envWith = (publicKey: string): Env =>
  ({
    CONFIG: undefined,
    AI_BASE_URL: 'https://ai.example.com/v1',
    AI_MODEL: 'test-model',
    AI_API_KEY: 'test-key',
    CTFTIME_USER_AGENT: 'ctf-weekly-jp/test',
    DISCORD_WEBHOOK_URL: 'https://discord.example.com/webhook',
    DISCORD_PUBLIC_KEY: publicKey,
    DISCORD_APP_ID: 'app-id',
  }) as unknown as Env;

describe('worker.fetch', () => {
  it('answers the health check', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example.com/health'),
      envWith(''),
      ctx,
    );
    expect(response.status).toBe(200);
  });

  it('404s an unknown path', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example.com/nope'),
      envWith(''),
      ctx,
    );
    expect(response.status).toBe(404);
  });

  it('rejects an unsigned interaction', async () => {
    const request = new Request('https://worker.example.com/interactions', {
      method: 'POST',
      body: '{"type":1}',
    });
    const response = await worker.fetch(request, envWith(''), ctx);
    expect(response.status).toBe(401);
  });

  it('answers a signed PING', async () => {
    const { publicKey, sign } = await makeKeypair();
    const request = await signedRequest({ body: '{"type":1}', timestamp: TIMESTAMP, sign });

    const response = await worker.fetch(request, envWith(publicKey), ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it('answers a signed request whose body is not JSON with a 400, not a crash', async () => {
    const { publicKey, sign } = await makeKeypair();
    const request = await signedRequest({ body: 'not json at all', timestamp: TIMESTAMP, sign });

    const response = await worker.fetch(request, envWith(publicKey), ctx);

    expect(response.status).toBe(400);
  });

  it('handles a command that throws instead of returning an unhandled 500', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { publicKey, sign } = await makeKeypair();
    const body = JSON.stringify({
      type: 2,
      token: 't',
      application_id: 'app-id',
      data: { name: 'ctf', options: [{ name: 'config', type: 2, options: [{ name: 'show', type: 1 }] }] },
    });
    const request = await signedRequest({ body, timestamp: TIMESTAMP, sign });
    const broken = {
      ...envWith(publicKey),
      get CONFIG(): never {
        throw new Error('binding missing');
      },
    } as unknown as Env;

    const response = await worker.fetch(request, broken, ctx);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data?: { content?: string } };
    expect(payload.data?.content).toContain('エラー');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('worker.scheduled', () => {
  it('logs when the weekly run itself throws rather than rejecting in the background', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scheduled: Promise<unknown>[] = [];
    const broken = {
      ...envWith(''),
      get CONFIG(): never {
        throw new Error('binding missing');
      },
    } as unknown as Env;

    await worker.scheduled({} as ScheduledController, broken, {
      waitUntil: (promise: Promise<unknown>) => void scheduled.push(promise),
    } as unknown as ExecutionContext);

    await expect(scheduled[0]).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
