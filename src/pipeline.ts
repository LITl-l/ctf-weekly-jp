import type { CtftimeEvent, DigestConfig, DiscordMessage, Env, EventSummary } from './types';
import { describeFailure, digestWindow, fetchEvents, type FetchFailure } from './ctftime';
import { filterEvents } from './filter';
import { loadConfig } from './config';
import { mapWithConcurrency, summarizeEvent } from './ai';
import { buildErrorMessage, buildMessages } from './render';
import { postMessages, type PostFailure } from './discord/webhook';
import { ok, type Result } from './result';

/** Free-tier AI endpoints rate-limit aggressively; three in flight is plenty. */
const AI_CONCURRENCY = 3;

export interface DigestOptions {
  readonly now?: Date;
  readonly fetchImpl?: typeof fetch;
  /** Overrides KV config. Used by the dry-run script and tests. */
  readonly config?: DigestConfig;
}

export interface DigestResult {
  readonly messages: ReadonlyArray<DiscordMessage>;
  readonly events: ReadonlyArray<CtftimeEvent>;
  readonly summaries: ReadonlyArray<EventSummary>;
  readonly config: DigestConfig;
  /** Present when CTFtime could not be read. The digest still carries a message. */
  readonly failure?: FetchFailure;
}

/**
 * Fetch → filter → summarise → render.
 *
 * Total by contract: an upstream outage still produces a message, because
 * silence in the channel is indistinguishable from "no events this week".
 */
export const runDigest = async (env: Env, options: DigestOptions = {}): Promise<DigestResult> => {
  const { now = new Date(), fetchImpl = fetch } = options;
  const config = options.config ?? (await loadConfig(env.CONFIG));
  const window = digestWindow(config.days, now);

  const fetched = await fetchEvents({
    days: config.days,
    userAgent: env.CTFTIME_USER_AGENT,
    now,
    fetchImpl,
  });

  if (!fetched.ok) {
    return {
      messages: [{ content: buildErrorMessage(describeFailure(fetched.error)) }],
      events: [],
      summaries: [],
      config,
      failure: fetched.error,
    };
  }

  const events = filterEvents(fetched.value, config);
  const summaries = await mapWithConcurrency(events, AI_CONCURRENCY, (event) =>
    summarizeEvent(event, {
      baseUrl: env.AI_BASE_URL,
      model: env.AI_MODEL,
      apiKey: env.AI_API_KEY,
      fetchImpl,
    }),
  );

  return { messages: buildMessages(events, summaries, window), events, summaries, config };
};

export const runAndPost = async (
  env: Env,
  options: DigestOptions = {},
): Promise<Result<DigestResult, PostFailure>> => {
  const digest = await runDigest(env, options);
  const posted = await postMessages(
    env.DISCORD_WEBHOOK_URL,
    digest.messages,
    options.fetchImpl ?? fetch,
  );
  return posted.ok ? ok(digest) : posted;
};
