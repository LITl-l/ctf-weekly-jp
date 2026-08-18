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

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;|&#39;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Strip, collapse to a single line, and cut to length — for prompts and fallbacks. */
export function plainText(html: string | undefined, max: number): string {
  return truncate(stripHtml(html ?? '').replace(/\s+/g, ' ').trim(), max);
}
