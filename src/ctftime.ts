import type { CtftimeEvent, DateWindow } from './types';
import { attemptAsync, err, ok, type Result } from './result';

const API_URL = 'https://ctftime.org/api/v1/events/';

/**
 * CTFtime sits behind Cloudflare and answers 403 to requests without a
 * recognisable User-Agent. Verified by probe: no UA -> 403, custom UA -> 200.
 * Never drop this header.
 */
export const DEFAULT_USER_AGENT = 'ctf-weekly-jp/1.0 (+https://github.com/LITl-l/ctf-weekly-jp)';

export type FetchFailure =
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'shape'; readonly message: string };

export const describeFailure = (failure: FetchFailure): string => {
  switch (failure.kind) {
    case 'http':
      return `CTFtime returned ${failure.status}`;
    case 'network':
      return `network error: ${failure.message}`;
    case 'shape':
      return `unexpected payload: ${failure.message}`;
  }
};

export interface FetchOptions {
  readonly days: number;
  readonly userAgent?: string;
  /** Window start. Defaults to now. Injected by tests for determinism. */
  readonly now?: Date;
  readonly limit?: number;
  readonly fetchImpl?: typeof fetch;
  /** Retries after the first attempt. */
  readonly retries?: number;
  readonly retryDelayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const buildUrl = (window: DateWindow, limit: number): string => {
  const start = Math.floor(window.from.getTime() / 1000);
  const finish = Math.floor(window.to.getTime() / 1000);
  return `${API_URL}?limit=${limit}&start=${start}&finish=${finish}`;
};

const readEvents = async (
  response: Response,
): Promise<Result<ReadonlyArray<CtftimeEvent>, FetchFailure>> => {
  if (!response.ok) return err({ kind: 'http', status: response.status });

  const parsed = await attemptAsync(
    () => response.json() as Promise<unknown>,
    (cause): FetchFailure => ({ kind: 'shape', message: String(cause) }),
  );
  if (!parsed.ok) return parsed;

  return Array.isArray(parsed.value)
    ? ok(parsed.value as ReadonlyArray<CtftimeEvent>)
    : err({ kind: 'shape', message: 'expected an array of events' });
};

/** Fetches events starting within the next `days` days. Never throws. */
export const fetchEvents = async (
  options: FetchOptions,
): Promise<Result<ReadonlyArray<CtftimeEvent>, FetchFailure>> => {
  const {
    days,
    userAgent = DEFAULT_USER_AGENT,
    now = new Date(),
    limit = 100,
    fetchImpl = fetch,
    retries = 1,
    retryDelayMs = 1000,
  } = options;

  const url = buildUrl(digestWindow(days, now), limit);

  const once = async (): Promise<Result<ReadonlyArray<CtftimeEvent>, FetchFailure>> => {
    const response = await attemptAsync(
      () => fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } }),
      (cause): FetchFailure => ({ kind: 'network', message: String(cause) }),
    );
    return response.ok ? readEvents(response.value) : response;
  };

  const attemptWithRetries = async (
    remaining: number,
  ): Promise<Result<ReadonlyArray<CtftimeEvent>, FetchFailure>> => {
    const result = await once();
    if (result.ok || remaining <= 0) return result;
    await sleep(retryDelayMs);
    return attemptWithRetries(remaining - 1);
  };

  return attemptWithRetries(retries);
};

/** Window boundaries for the digest header. */
export const digestWindow = (days: number, now = new Date()): DateWindow => ({
  from: now,
  to: new Date(now.getTime() + days * 86400 * 1000),
});
