import type { DiscordMessage, Env } from '../types';
import { applyConfigKey, formatConfig, loadConfig, resetConfig, saveConfig } from '../config';
import { runDigest } from '../pipeline';
import { attemptAsync } from '../result';

const API_BASE = 'https://discord.com/api/v10';

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

const EPHEMERAL = 64;

const RUN_FAILED = '⚠️ ダイジェストの生成に失敗しました。しばらくしてからもう一度お試しください。';
const INTERNAL_ERROR = '⚠️ 内部エラーが発生しました。時間をおいて再度お試しください。';

interface InteractionOption {
  readonly name: string;
  readonly type: number;
  readonly value?: string | number | boolean;
  readonly options?: ReadonlyArray<InteractionOption>;
}

export interface Interaction {
  readonly type: number;
  readonly token: string;
  readonly application_id: string;
  readonly data?: { readonly name: string; readonly options?: ReadonlyArray<InteractionOption> };
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const ephemeral = (content: string): Response =>
  json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  });

const optionValue = (
  options: ReadonlyArray<InteractionOption> | undefined,
  name: string,
): string | undefined => {
  const found = options?.find((option) => option.name === name);
  return found?.value === undefined ? undefined : String(found.value);
};

/**
 * Never throws and never returns a verdict: nothing downstream of a deferred
 * reply can act on a failed follow-up, so the only useful outcome is a log line.
 * Silence here is what leaves a user staring at a placeholder forever.
 */
const sendJson = async (
  fetchImpl: typeof fetch,
  url: string,
  method: 'POST' | 'PATCH',
  body: DiscordMessage,
): Promise<void> => {
  const sent = await attemptAsync(
    () =>
      fetchImpl(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    (cause) => String(cause),
  );

  if (!sent.ok) {
    console.error('discord follow-up failed', { method, error: sent.error });
    return;
  }
  if (!sent.value.ok) {
    const detail = await sent.value.text().catch(() => '');
    console.error('discord rejected a follow-up', { method, status: sent.value.status, detail });
  }
};

/**
 * Discord kills any interaction not acknowledged within 3 seconds, and a digest
 * run takes far longer. So `/ctf next` defers immediately and finishes the work
 * in `waitUntil`, then edits the placeholder. See ADR-0001.
 *
 * `runDigest` is total for every failure it can name, but a missing binding or a
 * platform fault is not one of them, and an unhandled rejection inside
 * `waitUntil` would abandon the placeholder without a word in the logs.
 */
const deliverDeferred = async (
  env: Env,
  interaction: Interaction,
  fetchImpl: typeof fetch,
): Promise<void> => {
  const followupBase = `${API_BASE}/webhooks/${interaction.application_id}/${interaction.token}`;
  const original = `${followupBase}/messages/@original`;

  const digest = await attemptAsync(
    () => runDigest(env, { fetchImpl }),
    (cause) => String(cause),
  );

  if (!digest.ok) {
    console.error('digest run failed', digest.error);
    await sendJson(fetchImpl, original, 'PATCH', { content: RUN_FAILED });
    return;
  }

  const [first, ...rest] = digest.value.messages;
  await sendJson(fetchImpl, original, 'PATCH', first ?? { content: '結果がありません。' });
  for (const message of rest) {
    await sendJson(fetchImpl, followupBase, 'POST', message);
  }
};

const handleConfig = async (
  env: Env,
  options: ReadonlyArray<InteractionOption> | undefined,
): Promise<Response> => {
  const sub = options?.[0];
  if (!sub) return ephemeral('サブコマンドを指定してください。');

  switch (sub.name) {
    case 'show':
      return ephemeral(formatConfig(await loadConfig(env.CONFIG)));

    case 'reset': {
      const reset = await resetConfig(env.CONFIG);
      if (!reset.ok) return ephemeral(`❌ ${reset.error}`);
      return ephemeral(`設定をリセットしました。\n\n${formatConfig(await loadConfig(env.CONFIG))}`);
    }

    case 'set': {
      const key = optionValue(sub.options, 'key');
      const value = optionValue(sub.options, 'value');
      if (!key || value === undefined) return ephemeral('key と value を指定してください。');

      const updated = applyConfigKey(await loadConfig(env.CONFIG), key, value);
      if (!updated.ok) return ephemeral(`❌ ${updated.error}`);

      const saved = await saveConfig(env.CONFIG, updated.value);
      if (!saved.ok) return ephemeral(`❌ ${saved.error}`);

      return ephemeral(
        `✅ \`${key}\` を \`${value}\` に更新しました。\n\n${formatConfig(updated.value)}`,
      );
    }

    default:
      return ephemeral(`不明なサブコマンド: ${sub.name}`);
  }
};

const route = async (
  interaction: Interaction,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  fetchImpl: typeof fetch,
): Promise<Response> => {
  if (interaction.type === InteractionType.PING) {
    return json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND || interaction.data?.name !== 'ctf') {
    return ephemeral('対応していないコマンドです。');
  }

  const sub = interaction.data.options?.[0];

  if (sub?.name === 'next') {
    ctx.waitUntil(deliverDeferred(env, interaction, fetchImpl));
    return json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
  }

  if (sub?.name === 'config') return handleConfig(env, sub.options);

  return ephemeral('サブコマンドを指定してください（`next` または `config`）。');
};

/**
 * Total by construction: Discord reads a 5xx on this endpoint as an unhealthy
 * one and will eventually stop delivering commands, so every fault becomes a
 * message the user can read instead.
 */
export const handleInteraction = async (
  interaction: Interaction,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  try {
    return await route(interaction, env, ctx, fetchImpl);
  } catch (cause) {
    console.error('interaction handling failed', cause);
    return ephemeral(INTERNAL_ERROR);
  }
};
