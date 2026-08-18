import type { CtftimeEvent, EventSummary } from './types';
import { isDifficulty, ruleSummary } from './difficulty';
import { plainText, truncate } from './text';
import { attempt, attemptAsync, err, ok, type Result } from './result';

export interface AiConfig {
  /** OpenAI-compatible base URL. Mistral, NVIDIA NIM, Groq and OpenRouter all fit. */
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export type AiFailure =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'shape'; readonly message: string };

const shape = (message: string): AiFailure => ({ kind: 'shape', message });

const SYSTEM_PROMPT = `あなたはCTF（Capture The Flag）に詳しい日本語のアシスタントです。
与えられたCTFイベント情報を読み、日本のCTF初心者に向けて要約と難易度推定を行います。

必ず次のJSONのみを出力してください（前後に説明文やコードフェンスを付けない）:
{
  "summary_ja": "日本語2〜3文の要約。何のCTFで、誰向けで、どんな特徴があるかを書く。",
  "categories": ["pwn" | "web" | "crypto" | "rev" | "forensics" | "misc" | "osint" | "hardware" | "blockchain" | "ppc"],
  "difficulty": "beginner" | "intermediate" | "advanced" | "unknown",
  "reason_ja": "難易度をそう判断した理由を日本語1文で。"
}

難易度の判断基準:
- weight は CTFtime によるイベント格付け。0 は「低い」ではなく「未評価」を意味する。
- weight が 0 の場合、説明文に初心者向け・学生向け・入門などの明示がない限り "unknown" とすること。
- weight 25未満は beginner、25〜50未満は intermediate、50以上は advanced が目安。
- 説明文に "beginner friendly" "for students" "introductory" などがあれば beginner に寄せてよい。
- 情報が乏しいときに憶測で beginner と断定しないこと。

categories は説明文から推測できるものだけを挙げ、根拠がなければ空配列にすること。`;

const buildUserPrompt = (event: CtftimeEvent): string =>
  [
    `タイトル: ${event.title}`,
    `形式: ${event.format}`,
    `開催形態: ${event.onsite ? `オンサイト (${event.location || '場所不明'})` : 'オンライン'}`,
    `参加制限: ${event.restrictions || '不明'}`,
    `CTFtime weight: ${event.weight} ${!event.weight ? '(未評価)' : ''}`,
    `登録チーム数: ${event.participants}`,
    `開催期間: ${event.duration?.days ?? 0}日${event.duration?.hours ?? 0}時間`,
    `主催: ${event.organizers?.map((o) => o.name).join(', ') || '不明'}`,
    `賞金: ${plainText(event.prizes, 200) || 'なし'}`,
    `公式説明: ${plainText(event.description, 1500) || 'なし'}`,
  ].join('\n');

/** Models sometimes wrap JSON in code fences despite instructions. */
export const extractJson = (content: string): Result<unknown, AiFailure> => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return err(shape('no JSON object in response'));
  }
  return attempt(
    () => JSON.parse(candidate.slice(start, end + 1)) as unknown,
    (cause) => shape(String(cause)),
  );
};

const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set([
  'pwn', 'web', 'crypto', 'rev', 'forensics', 'misc', 'osint', 'hardware', 'blockchain', 'ppc',
]);

export const parseSummary = (raw: unknown): Result<EventSummary, AiFailure> => {
  if (typeof raw !== 'object' || raw === null) return err(shape('response is not an object'));
  const record = raw as Record<string, unknown>;

  const summaryJa = typeof record.summary_ja === 'string' ? record.summary_ja.trim() : '';
  if (!summaryJa) return err(shape('summary_ja missing'));
  if (!isDifficulty(record.difficulty)) return err(shape('difficulty invalid'));

  const categories = Array.isArray(record.categories)
    ? record.categories
        .filter((category): category is string => typeof category === 'string')
        .map((category) => category.trim().toLowerCase())
        .filter((category) => ALLOWED_CATEGORIES.has(category))
    : [];

  const reasonJa =
    typeof record.reason_ja === 'string' && record.reason_ja.trim()
      ? record.reason_ja.trim()
      : '（理由の記載なし）';

  return ok({
    summaryJa: truncate(summaryJa, 900),
    categories,
    difficulty: record.difficulty,
    reasonJa: truncate(reasonJa, 300),
    source: 'ai',
  });
};

const requestSummary = async (
  event: CtftimeEvent,
  ai: AiConfig,
): Promise<Result<EventSummary, AiFailure>> => {
  const { baseUrl, model, apiKey, fetchImpl = fetch, timeoutMs = 30_000 } = ai;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(event) },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const send = (jsonMode: boolean): Promise<Result<Response, AiFailure>> =>
    attemptAsync(
      () =>
        fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
            temperature: 0.2,
            max_tokens: 700,
          }),
          signal: controller.signal,
        }),
      (cause): AiFailure => ({ kind: 'network', message: String(cause) }),
    );

  const run = async (): Promise<Result<EventSummary, AiFailure>> => {
    const first = await send(true);

    // Not every OpenAI-compatible endpoint accepts response_format — some NVIDIA
    // NIM models reject it with 400. Without this retry the whole digest would
    // quietly fall back to rules while looking perfectly healthy. The system
    // prompt already demands bare JSON, so dropping the flag is safe. ADR-0002.
    const sent = first.ok && first.value.status === 400 ? await send(false) : first;
    if (!sent.ok) return sent;

    const response = sent.value;
    if (!response.ok) return err({ kind: 'http', status: response.status });

    const body = await attemptAsync(
      () => response.json() as Promise<{ choices?: Array<{ message?: { content?: string } }> }>,
      (cause): AiFailure => shape(String(cause)),
    );
    if (!body.ok) return body;

    const content = body.value.choices?.[0]?.message?.content;
    if (!content) return err(shape('no content in response'));

    const json = extractJson(content);
    return json.ok ? parseSummary(json.value) : json;
  };

  const result = await run();
  clearTimeout(timer);
  return result;
};

/**
 * Total by contract: every failure becomes a rule-based verdict, so an event is
 * never dropped because the model was unavailable. This is the one place that
 * deliberately absorbs a Result rather than propagating it. See ADR-0004.
 */
export const summarizeEvent = async (
  event: CtftimeEvent,
  ai: AiConfig,
): Promise<EventSummary> => {
  if (!ai.apiKey) return ruleSummary(event);
  const result = await requestSummary(event, ai);
  return result.ok ? result.value : ruleSummary(event);
};

/**
 * Bounded concurrency keeps us inside free-tier rate limits (NVIDIA NIM: 40 RPM).
 *
 * The cursor is mutable, deliberately. It is confined to this closure, so the
 * function is referentially transparent from outside. The functional
 * alternative — partitioning items into fixed lanes — would let one slow request
 * block its entire lane, and free-tier latency varies by an order of magnitude.
 * See ADR-0004.
 */
export const mapWithConcurrency = async <T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<ReadonlyArray<R>> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
};
