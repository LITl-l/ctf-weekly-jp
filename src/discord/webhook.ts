import type { DiscordMessage } from '../types';
import { attemptAsync, err, ok, unwrapOr, type Result } from '../result';
import { truncate } from '../text';

const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 10_000;

export type PostFailure =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number; readonly detail: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const readRetryAfterMs = async (response: Response): Promise<number> => {
  const body = await attemptAsync(
    () => response.json() as Promise<{ retry_after?: number }>,
    () => null,
  );
  const seconds = body.ok ? (body.value.retry_after ?? 1) : 1;
  return Math.min(seconds * 1000, MAX_BACKOFF_MS);
};

/**
 * Discord explains a rejection in the response body — `embeds: Must be 6000 or
 * fewer in length` and the like. Dropping it leaves an operator with a bare
 * status code and no way to tell a malformed payload from a revoked webhook.
 */
const readDetail = async (response: Response): Promise<string> => {
  const body = await attemptAsync(
    () => response.text(),
    () => '',
  );
  return truncate(unwrapOr(body, '').trim(), 500);
};

const postOnce = (
  url: string,
  message: DiscordMessage,
  fetchImpl: typeof fetch,
): Promise<Result<Response, PostFailure>> =>
  attemptAsync(
    () =>
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }),
    (cause): PostFailure => ({ kind: 'network', message: String(cause) }),
  );

/** Retries only on 429, honouring Discord's `retry_after` (seconds). */
const postWithRetry = async (
  url: string,
  message: DiscordMessage,
  fetchImpl: typeof fetch,
  attemptsLeft: number,
): Promise<Result<void, PostFailure>> => {
  const sent = await postOnce(url, message, fetchImpl);
  if (!sent.ok) return sent;
  if (sent.value.ok) return ok(undefined);

  if (sent.value.status === 429 && attemptsLeft > 1) {
    await sleep(await readRetryAfterMs(sent.value));
    return postWithRetry(url, message, fetchImpl, attemptsLeft - 1);
  }
  return err({ kind: 'http', status: sent.value.status, detail: await readDetail(sent.value) });
};

/**
 * Posts messages in order, stopping at the first failure. Sequential by design:
 * a digest reads wrong if its embeds arrive shuffled.
 */
export const postMessages = (
  webhookUrl: string,
  messages: ReadonlyArray<DiscordMessage>,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<void, PostFailure>> =>
  messages.reduce<Promise<Result<void, PostFailure>>>(
    async (previous, message) => {
      const result = await previous;
      return result.ok ? postWithRetry(webhookUrl, message, fetchImpl, MAX_ATTEMPTS) : result;
    },
    Promise.resolve(ok(undefined)),
  );
