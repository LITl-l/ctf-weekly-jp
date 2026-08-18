import type { DiscordMessage, Env } from '../types';
import { applyConfigKey, formatConfig, loadConfig, resetConfig, saveConfig } from '../config';
import { runDigest } from '../pipeline';

const API_BASE = 'https://discord.com/api/v10';

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

const EPHEMERAL = 64;

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

const sendJson = (url: string, method: 'POST' | 'PATCH', body: DiscordMessage): Promise<Response> =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * Discord kills any interaction not acknowledged within 3 seconds, and a digest
 * run takes far longer. So `/ctf next` defers immediately and finishes the work
 * in `waitUntil`, then edits the placeholder. See ADR-0001.
 *
 * No error handling here on purpose: `runDigest` is total and always returns a
 * message, including for an upstream outage.
 */
const deliverDeferred = async (env: Env, interaction: Interaction): Promise<void> => {
  const followupBase = `${API_BASE}/webhooks/${interaction.application_id}/${interaction.token}`;
  const [first, ...rest] = (await runDigest(env)).messages;

  await sendJson(
    `${followupBase}/messages/@original`,
    'PATCH',
    first ?? { content: '結果がありません。' },
  );

  await rest.reduce<Promise<unknown>>(
    async (previous, message) => {
      await previous;
      return sendJson(followupBase, 'POST', message);
    },
    Promise.resolve(undefined),
  );
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

    case 'reset':
      await resetConfig(env.CONFIG);
      return ephemeral(`設定をリセットしました。\n\n${formatConfig(await loadConfig(env.CONFIG))}`);

    case 'set': {
      const key = optionValue(sub.options, 'key');
      const value = optionValue(sub.options, 'value');
      if (!key || value === undefined) return ephemeral('key と value を指定してください。');

      const updated = applyConfigKey(await loadConfig(env.CONFIG), key, value);
      if (!updated.ok) return ephemeral(`❌ ${updated.error}`);

      await saveConfig(env.CONFIG, updated.value);
      return ephemeral(
        `✅ \`${key}\` を \`${value}\` に更新しました。\n\n${formatConfig(updated.value)}`,
      );
    }

    default:
      return ephemeral(`不明なサブコマンド: ${sub.name}`);
  }
};

export const handleInteraction = async (
  interaction: Interaction,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> => {
  if (interaction.type === InteractionType.PING) {
    return json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND || interaction.data?.name !== 'ctf') {
    return ephemeral('対応していないコマンドです。');
  }

  const sub = interaction.data.options?.[0];

  if (sub?.name === 'next') {
    ctx.waitUntil(deliverDeferred(env, interaction));
    return json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
  }

  if (sub?.name === 'config') return handleConfig(env, sub.options);

  return ephemeral('サブコマンドを指定してください（`next` または `config`）。');
};
