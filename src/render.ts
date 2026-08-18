import type {
  CtftimeEvent,
  DateWindow,
  DiscordEmbed,
  DiscordEmbedField,
  DiscordMessage,
  EventSummary,
} from './types';
import { DIFFICULTY_COLORS, DIFFICULTY_LABELS } from './difficulty';
import { truncate } from './text';

const JST = 'Asia/Tokyo';
const EMBEDS_PER_MESSAGE = 10;

const RESTRICTION_JA: Readonly<Record<string, string>> = {
  open: '誰でも参加可',
  casual: 'カジュアル（誰でも参加可）',
  individual: '個人戦（誰でも参加可）',
  prequalified: '予選通過者のみ',
  invited: '招待制',
  academic: '学生・教育機関限定',
  'high-school': '高校生限定',
};

const FORMAT_JA: Readonly<Record<string, string>> = {
  jeopardy: 'Jeopardy（問題解答形式）',
  'attack-defense': 'Attack-Defense（攻防戦）',
};

const jstParts = (date: Date): Readonly<Record<string, string>> =>
  Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: JST,
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

export const formatJstDateTime = (date: Date): string => {
  const p = jstParts(date);
  return `${p.month}月${p.day}日(${p.weekday}) ${p.hour}:${p.minute}`;
};

export const formatJstDate = (date: Date): string => {
  const p = jstParts(date);
  return `${p.month}月${p.day}日`;
};

const formatDuration = (event: CtftimeEvent): string => {
  const days = event.duration?.days ?? 0;
  const hours = event.duration?.hours ?? 0;
  if (days && hours) return `${days}日${hours}時間`;
  return days ? `${days}日` : `${hours}時間`;
};

export const translateRestriction = (restrictions: string): string => {
  const key = (restrictions ?? '').trim().toLowerCase();
  return RESTRICTION_JA[key] ?? (restrictions || '不明');
};

export const translateFormat = (event: CtftimeEvent): string => {
  const key = (event.format ?? '').trim().toLowerCase();
  const format = FORMAT_JA[key] ?? (event.format || '不明');
  const venue = event.onsite ? `オンサイト（${event.location || '場所未定'}）` : 'オンライン';
  return `${format} / ${venue}`;
};

const buildFields = (
  event: CtftimeEvent,
  summary: EventSummary,
): ReadonlyArray<DiscordEmbedField> => [
  {
    name: '📅 開催期間（JST）',
    value: `${formatJstDateTime(new Date(event.start))} 〜 ${formatJstDateTime(new Date(event.finish))}\n（${formatDuration(event)}）`,
    inline: false,
  },
  { name: '🎯 形式', value: truncate(translateFormat(event), 1024), inline: true },
  { name: '🔑 参加条件', value: translateRestriction(event.restrictions), inline: true },
  { name: '⚖️ weight', value: event.weight ? event.weight.toFixed(2) : '未評価', inline: true },
  {
    name: '🧩 予想ジャンル',
    value: summary.categories.length ? summary.categories.join(' / ') : '情報なし',
    inline: false,
  },
  {
    name: `${DIFFICULTY_LABELS[summary.difficulty]}（${summary.source === 'ai' ? 'AI推定' : '自動判定'}）`,
    value: truncate(summary.reasonJa, 1024),
    inline: false,
  },
  ...(event.url
    ? [{ name: '🔗 公式サイト', value: truncate(event.url, 1024), inline: false }]
    : []),
];

const FOOTER: Readonly<Record<EventSummary['source'], string>> = {
  ai: '難易度・ジャンルはAIによる推定です · 出典: CTFtime',
  rule: '難易度はweightからの自動判定です（AI要約は取得できませんでした） · 出典: CTFtime',
};

export const buildEmbed = (event: CtftimeEvent, summary: EventSummary): DiscordEmbed => ({
  title: truncate(`${DIFFICULTY_LABELS[summary.difficulty].split(' ')[0]} ${event.title}`, 256),
  url: event.ctftime_url,
  description: truncate(summary.summaryJa, 2000),
  color: DIFFICULTY_COLORS[summary.difficulty],
  ...(event.logo ? { thumbnail: { url: event.logo } } : {}),
  fields: buildFields(event, summary),
  footer: { text: FOOTER[summary.source] },
});

const formatRange = (window: DateWindow): string =>
  `${formatJstDate(window.from)}〜${formatJstDate(window.to)}`;

export const buildHeader = (
  events: ReadonlyArray<CtftimeEvent>,
  summaries: ReadonlyArray<EventSummary>,
  window: DateWindow,
): string => {
  const beginner = summaries.filter((summary) => summary.difficulty === 'beginner').length;
  const beginnerNote =
    beginner > 0 ? `うち初心者向け **${beginner}件** 🟢` : '初心者向け判定のイベントはありません';
  return [
    `## 📢 今週のCTF（${formatRange(window)}）— 全 **${events.length}件**`,
    beginnerNote,
    '難易度はAIによる推定です。参加前に必ず公式情報をご確認ください。',
  ].join('\n');
};

const chunk = <T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

/** Discord allows at most 10 embeds per message, so long digests span messages. */
export const buildMessages = (
  events: ReadonlyArray<CtftimeEvent>,
  summaries: ReadonlyArray<EventSummary>,
  window: DateWindow,
): ReadonlyArray<DiscordMessage> => {
  if (events.length === 0) return [{ content: buildEmptyMessage(window) }];

  return chunk(
    events.map((event, index) => buildEmbed(event, summaries[index]!)),
    EMBEDS_PER_MESSAGE,
  ).map((embeds, index) => ({
    ...(index === 0 ? { content: buildHeader(events, summaries, window) } : {}),
    embeds,
  }));
};

export const buildEmptyMessage = (window: DateWindow): string =>
  `## 📢 今週のCTF（${formatRange(window)}）\n条件に合うCTFはありませんでした。\`/ctf config show\` で絞り込み条件を確認できます。`;

export const buildErrorMessage = (reason: string): string =>
  `⚠️ CTFtimeからイベントを取得できませんでした。\n\`\`\`\n${truncate(reason, 500)}\n\`\`\``;
