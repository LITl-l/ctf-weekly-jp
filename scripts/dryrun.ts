/**
 * Live end-to-end dry run: hits the real CTFtime API, runs the real pipeline,
 * and prints the digest to stdout. Nothing is posted to Discord.
 *
 *   npm run dryrun                        # rule-based difficulty only
 *   AI_API_KEY=... npm run dryrun         # with AI summaries
 *   DAYS=30 npm run dryrun                # widen the window
 *   MAX_EVENTS=1 npm run dryrun           # limit events (handy with slow local models)
 */
import type { DigestConfig, DiscordEmbed, Env } from '../src/types';
import { DEFAULT_CONFIG } from '../src/config';
import { describeAiFailure } from '../src/ai';
import { runDigest } from '../src/pipeline';

const config: DigestConfig = {
  ...DEFAULT_CONFIG,
  days: Number(process.env.DAYS ?? DEFAULT_CONFIG.days),
  maxEvents: Number(process.env.MAX_EVENTS ?? DEFAULT_CONFIG.maxEvents),
};

const env = {
  CONFIG: undefined,
  // Kept in step with wrangler.toml's [vars]. If these drifted, a key issued
  // for the deployed provider would be posted to a different vendor entirely.
  AI_BASE_URL: process.env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
  AI_MODEL: process.env.AI_MODEL ?? 'gemini-3.5-flash-lite',
  AI_API_KEY: process.env.AI_API_KEY ?? '',
  CTFTIME_USER_AGENT: process.env.CTFTIME_USER_AGENT ?? 'ctf-weekly-jp/1.0 (dry-run)',
  DISCORD_WEBHOOK_URL: '',
  DISCORD_PUBLIC_KEY: '',
  DISCORD_APP_ID: '',
} as unknown as Env;

function printEmbed(embed: DiscordEmbed): void {
  console.log(`\n── ${embed.title ?? '(no title)'}`);
  console.log(`   ${embed.url ?? ''}`);
  if (embed.description) console.log(`   ${embed.description.replace(/\n/g, '\n   ')}`);
  for (const field of embed.fields ?? []) {
    console.log(`   ${field.name}: ${field.value.replace(/\n/g, ' / ')}`);
  }
  if (embed.footer) console.log(`   [${embed.footer.text}]`);
}

const started = Date.now();
console.log(`AI: ${env.AI_API_KEY ? `${env.AI_MODEL} @ ${env.AI_BASE_URL}` : '(none — rule-based fallback)'}`);
console.log(`Window: ${config.days} days\n`);

const result = await runDigest(env, { config });

for (const message of result.messages) {
  if (message.content) console.log(message.content);
  for (const embed of message.embeds ?? []) printEmbed(embed);
}

const bySource = result.summaries.reduce<Record<string, number>>((acc, s) => {
  acc[s.source] = (acc[s.source] ?? 0) + 1;
  return acc;
}, {});

/**
 * Grouped, because a retired model fails identically for every event: 15 copies
 * of one line buries the digest it is supposed to annotate. `summaries:
 * {"rule":15}` on its own says the AI did not answer but never why.
 */
const aiFailures = result.summaries.flatMap((s) => (s.aiFailure ? [s.aiFailure] : []));
const byFailure = aiFailures.reduce<Map<string, number>>((acc, failure) => {
  const label = describeAiFailure(failure);
  return acc.set(label, (acc.get(label) ?? 0) + 1);
}, new Map());

console.log(`\n${'─'.repeat(60)}`);
console.log(`events: ${result.events.length} | summaries: ${JSON.stringify(bySource)} | ${Date.now() - started}ms`);
if (aiFailures.length) {
  console.log(`ai failures: ${aiFailures.length}/${result.summaries.length}`);
  for (const [label, count] of [...byFailure].sort((a, b) => b[1] - a[1])) {
    console.log(`  x${count} ${label}`);
  }
}
if (result.failure) console.log(`failure: ${JSON.stringify(result.failure)}`);
