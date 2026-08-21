import { describe, expect, it } from 'vitest';
import { plainText, stripHtml, truncate } from '../src/text';

describe('stripHtml', () => {
  it('removes the tags CTFtime authors actually use', () => {
    expect(stripHtml('<b>Welcome to BrunnerCTF 2026.</b>')).toBe('Welcome to BrunnerCTF 2026.');
    expect(stripHtml('see <a href="https://x.dev">here</a>')).toBe('see here');
  });

  it('decodes named and numeric entities', () => {
    expect(stripHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(stripHtml('&lt;script&gt;')).toBe('<script>');
    expect(stripHtml('caf&#233;')).toBe('café');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
  });

  it('decodes entities above the basic plane, where emoji live', () => {
    expect(stripHtml('smile &#128512; here')).toBe('smile 😀 here');
  });

  it('leaves an out-of-range numeric entity alone rather than throwing', () => {
    expect(stripHtml('&#99999999;')).toBe('&#99999999;');
  });

  it('turns block tags into newlines instead of jamming words together', () => {
    expect(stripHtml('<p>one</p><p>two</p>')).toBe('one\ntwo');
    expect(stripHtml('one<br>two')).toBe('one\ntwo');
  });

  it('leaves plain text untouched', () => {
    expect(stripHtml('just text')).toBe('just text');
  });
});

describe('plainText', () => {
  it('strips, flattens to one line, and truncates', () => {
    expect(plainText('<b>a</b>\n\n<i>b</i>', 100)).toBe('a b');
    expect(plainText('<b>' + 'x'.repeat(50) + '</b>', 10)).toHaveLength(10);
  });

  it('handles undefined input', () => {
    expect(plainText(undefined, 10)).toBe('');
  });
});

describe('truncate', () => {
  it('leaves short text alone and ellipsises long text', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 5)).toBe('abcd…');
  });

  it('never returns more characters than asked for', () => {
    expect(truncate('abc', 1)).toHaveLength(1);
    expect(truncate('abc', 0)).toHaveLength(0);
  });

  it('drops a surrogate pair whole rather than cutting it in half', () => {
    expect(truncate('🎉'.repeat(10), 6)).toBe('🎉🎉…');
  });
});
