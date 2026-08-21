/**
 * CTFtime descriptions are author-written HTML (`<b>`, `<a href>`, `&amp;`).
 * Discord renders markdown, not HTML, so tags must be stripped before they
 * reach an embed — otherwise readers see literal `<b>` in the channel.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const SURROGATE_END = 0xdfff;

/**
 * `String.fromCharCode` truncates mod 65536, so `&#128512;` (😀) would arrive as
 * a lone surrogate. Entities outside Unicode are left as written rather than
 * dropped — an unreadable entity is better than silently losing the text.
 */
const decodeCodePoint = (code: number): string | null =>
  code > MAX_CODE_POINT || (code >= SURROGATE_START && code <= SURROGATE_END)
    ? null
    : String.fromCodePoint(code);

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (entity, code: string) => decodeCodePoint(Number(code)) ?? entity)
    .replace(/&[a-z]+;|&#39;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A cut landing between a surrogate pair would emit half a character. */
const dropDanglingSurrogate = (text: string): string => {
  const last = text.charCodeAt(text.length - 1);
  return last >= SURROGATE_START && last <= HIGH_SURROGATE_END ? text.slice(0, -1) : text;
};

/** Result is never longer than `max`, so it is safe to use as a hard budget. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length <= max ? text : `${dropDanglingSurrogate(text.slice(0, max - 1))}…`;
}

/** Strip, collapse to a single line, and cut to length — for prompts and fallbacks. */
export function plainText(html: string | undefined, max: number): string {
  return truncate(stripHtml(html ?? '').replace(/\s+/g, ' ').trim(), max);
}
