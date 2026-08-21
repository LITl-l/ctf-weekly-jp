import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/ctftime.json';
import { fetchEvents } from '../src/ctftime';

const now = new Date('2026-08-18T00:00:00Z');
const events = fixture as unknown as ReadonlyArray<Record<string, unknown>>;

/** Each thunk answers one call; the last one answers every call after it. */
const respondWith = (...responses: ReadonlyArray<() => Response>) => {
  let call = 0;
  return vi.fn(async () =>
    responses[Math.min(call++, responses.length - 1)]!(),
  ) as unknown as typeof fetch;
};

const fetchFrom = (payload: unknown) =>
  fetchEvents({ days: 7, now, fetchImpl: respondWith(() => Response.json(payload)) });

describe('fetchEvents', () => {
  it('reads a live-shaped payload', async () => {
    const result = await fetchFrom(events);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(events.length);
  });

  it('drops an event it could never render instead of crashing the digest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchFrom([events[0]!, { ...events[1]!, start: undefined }, events[2]!]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects a date that Date cannot parse', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchFrom([{ ...events[0]!, start: 'not-a-date' }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('shape');
    warn.mockRestore();
  });

  it('reports a shape failure when a non-empty payload has nothing usable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchFrom([{ nope: true }, { also: 'nope' }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('shape');
    warn.mockRestore();
  });

  it('treats a genuinely empty week as success, not corruption', async () => {
    const result = await fetchFrom([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('does not retry a 403, which a second identical request cannot fix', async () => {
    const fetchImpl = respondWith(() => new Response('forbidden', { status: 403 }));
    const result = await fetchEvents({ days: 7, now, fetchImpl, retryDelayMs: 0 });

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 500, which a second request might survive', async () => {
    const fetchImpl = respondWith(
      () => new Response('boom', { status: 500 }),
      () => Response.json(events),
    );
    const result = await fetchEvents({ days: 7, now, fetchImpl, retryDelayMs: 0 });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a network error', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket closed');
      return Response.json(events);
    }) as unknown as typeof fetch;

    const result = await fetchEvents({ days: 7, now, fetchImpl, retryDelayMs: 0 });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
