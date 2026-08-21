import { describe, expect, it, vi } from 'vitest';
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

  it('rejects a fraction where only whole items make sense', () => {
    expect(applyConfigKey(DEFAULT_CONFIG, 'max_events', '2.7').ok).toBe(false);
    expect(applyConfigKey(DEFAULT_CONFIG, 'days', '7.5').ok).toBe(false);
  });

  it('rejects a blank value rather than reading it as zero', () => {
    expect(applyConfigKey(DEFAULT_CONFIG, 'weight_min', '').ok).toBe(false);
    expect(applyConfigKey(DEFAULT_CONFIG, 'weight_min', '   ').ok).toBe(false);
  });

  it('still allows a fractional weight, which CTFtime itself reports', () => {
    const result = applyConfigKey(DEFAULT_CONFIG, 'weight_min', '12.5');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.weightMin).toBe(12.5);
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

  it('ignores a stored value of the wrong type', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = { get: async () => ({ days: 'abc' }) } as unknown as KVNamespace;
    await expect(loadConfig(kv)).resolves.toEqual(DEFAULT_CONFIG);
    warn.mockRestore();
  });

  it('ignores a stored value outside the bounds the command enforces', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = { get: async () => ({ days: 999, maxEvents: 0 }) } as unknown as KVNamespace;
    await expect(loadConfig(kv)).resolves.toEqual(DEFAULT_CONFIG);
    warn.mockRestore();
  });

  it('keeps the sound keys when one stored value is corrupt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = { get: async () => ({ days: 30, weightMin: 'nonsense' }) } as unknown as KVNamespace;
    await expect(loadConfig(kv)).resolves.toEqual({ ...DEFAULT_CONFIG, days: 30 });
    warn.mockRestore();
  });

  it('ignores a stored value that is not an object at all', async () => {
    const kv = { get: async () => 'nonsense' } as unknown as KVNamespace;
    await expect(loadConfig(kv)).resolves.toEqual(DEFAULT_CONFIG);
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
