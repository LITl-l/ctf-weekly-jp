import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, applyConfigKey, formatConfig, loadConfig } from '../src/config';

describe('applyConfigKey', () => {
  it('rejects unknown keys and lists the valid ones', () => {
    const result = applyConfigKey(DEFAULT_CONFIG, 'nope', '1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('weight_min');
  });

  it('parses booleans in the forms users actually type', () => {
    for (const [input, expected] of [['true', true], ['off', false], ['1', true], ['0', false]] as const) {
      const result = applyConfigKey(DEFAULT_CONFIG, 'online_only', input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.onlineOnly).toBe(expected);
    }
  });

  it('rejects non-boolean values for boolean keys', () => {
    expect(applyConfigKey(DEFAULT_CONFIG, 'online_only', 'maybe').ok).toBe(false);
  });

  it('enforces numeric bounds', () => {
    expect(applyConfigKey(DEFAULT_CONFIG, 'days', '0').ok).toBe(false);
    expect(applyConfigKey(DEFAULT_CONFIG, 'days', '61').ok).toBe(false);
    expect(applyConfigKey(DEFAULT_CONFIG, 'days', 'abc').ok).toBe(false);
    const ok = applyConfigKey(DEFAULT_CONFIG, 'days', '14');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.days).toBe(14);
  });
});

describe('loadConfig', () => {
  it('returns defaults with no KV binding', async () => {
    await expect(loadConfig(undefined)).resolves.toEqual(DEFAULT_CONFIG);
  });

  it('merges partial overrides over defaults', async () => {
    const kv = { get: async () => ({ days: 30 }) } as unknown as KVNamespace;
    await expect(loadConfig(kv)).resolves.toEqual({ ...DEFAULT_CONFIG, days: 30 });
  });

  it('falls back to defaults when KV throws', async () => {
    const kv = { get: async () => { throw new Error('kv down'); } } as unknown as KVNamespace;
    await expect(loadConfig(kv)).resolves.toEqual(DEFAULT_CONFIG);
  });
});

describe('formatConfig', () => {
  it('renders every key', () => {
    const text = formatConfig(DEFAULT_CONFIG);
    for (const key of ['days', 'online_only', 'include_restricted', 'weight_min', 'max_events']) {
      expect(text).toContain(key);
    }
  });
});
