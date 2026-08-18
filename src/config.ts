import type { DigestConfig } from './types';
import { attemptAsync, err, ok, unwrapOr, type Result } from './result';

export const DEFAULT_CONFIG: DigestConfig = {
  days: 7,
  onlineOnly: true,
  includeRestricted: false,
  weightMin: 0,
  maxEvents: 15,
};

const KV_KEY = 'config';

interface KeySpec {
  readonly field: keyof DigestConfig;
  readonly type: 'number' | 'boolean';
  readonly min?: number;
  readonly max?: number;
  readonly description: string;
}

/** Snake_case names are what users type into `/ctf config set`. */
export const CONFIG_KEYS: Readonly<Record<string, KeySpec>> = {
  days: { field: 'days', type: 'number', min: 1, max: 60, description: '先読み日数' },
  online_only: { field: 'onlineOnly', type: 'boolean', description: 'オンライン開催のみ' },
  include_restricted: {
    field: 'includeRestricted',
    type: 'boolean',
    description: '参加制限つき（予選通過者限定など）も含める',
  },
  weight_min: {
    field: 'weightMin',
    type: 'number',
    min: 0,
    max: 100,
    description: '最小weight（未評価イベントは常に表示）',
  },
  max_events: { field: 'maxEvents', type: 'number', min: 1, max: 50, description: '最大表示件数' },
};

const TRUTHY: ReadonlyArray<string> = ['true', 'on', '1'];
const BOOLEANS: ReadonlyArray<string> = [...TRUTHY, 'false', 'off', '0'];

const parseBoolean = (key: string, raw: string): Result<boolean, string> => {
  const normalized = raw.trim().toLowerCase();
  return BOOLEANS.includes(normalized)
    ? ok(TRUTHY.includes(normalized))
    : err(`\`${key}\` には true / false を指定してください。`);
};

const parseNumber = (key: string, raw: string, spec: KeySpec): Result<number, string> => {
  const value = Number(raw);
  if (!Number.isFinite(value)) return err(`\`${key}\` には数値を指定してください。`);
  if (spec.min !== undefined && value < spec.min) {
    return err(`\`${key}\` は ${spec.min} 以上にしてください。`);
  }
  if (spec.max !== undefined && value > spec.max) {
    return err(`\`${key}\` は ${spec.max} 以下にしてください。`);
  }
  return ok(value);
};

/** Applies one `key = value` override, validating against the key table. */
export const applyConfigKey = (
  config: DigestConfig,
  key: string,
  rawValue: string,
): Result<DigestConfig, string> => {
  const spec = CONFIG_KEYS[key];
  if (!spec) {
    return err(`不明な設定キー: \`${key}\`（有効: ${Object.keys(CONFIG_KEYS).join(', ')}）`);
  }

  const parsed =
    spec.type === 'boolean' ? parseBoolean(key, rawValue) : parseNumber(key, rawValue, spec);

  return parsed.ok ? ok({ ...config, [spec.field]: parsed.value }) : parsed;
};

/** Total: KV absence or corruption yields defaults rather than a failure. */
export const loadConfig = async (kv: KVNamespace | undefined): Promise<DigestConfig> => {
  if (!kv) return DEFAULT_CONFIG;

  const stored = await attemptAsync(
    () => kv.get<Partial<DigestConfig>>(KV_KEY, 'json'),
    () => 'kv read failed',
  );

  return { ...DEFAULT_CONFIG, ...(unwrapOr(stored, null) ?? {}) };
};

export const saveConfig = (kv: KVNamespace, config: DigestConfig): Promise<void> =>
  kv.put(KV_KEY, JSON.stringify(config));

export const resetConfig = (kv: KVNamespace): Promise<void> => kv.delete(KV_KEY);

export const formatConfig = (config: DigestConfig): string => {
  const lines = Object.entries(CONFIG_KEYS).map(
    ([key, spec]) => `\`${key}\` = **${config[spec.field]}**  — ${spec.description}`,
  );
  return `**現在の設定**\n${lines.join('\n')}`;
};
