/** Raw event shape returned by the CTFtime API (verified against a live response). */
export interface CtftimeEvent {
  readonly id: number;
  readonly ctf_id: number;
  readonly ctftime_url: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly logo: string;
  readonly start: string;
  readonly finish: string;
  readonly duration: { readonly hours: number; readonly days: number };
  readonly weight: number;
  readonly participants: number;
  readonly format: string;
  readonly format_id: number;
  readonly onsite: boolean;
  readonly location: string;
  readonly restrictions: string;
  readonly organizers: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  readonly prizes: string;
  readonly live_feed: string;
  readonly is_votable_now: boolean;
  readonly public_votable: boolean;
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'unknown';

/**
 * Why an AI summary could not be produced. Carried as data on the summary
 * itself rather than thrown or logged away: `summarizeEvent` is total by
 * contract, so the failure has nowhere else to go, and a failure nobody can see
 * is a failure nobody can diagnose. `body` is the provider's own response text,
 * truncated — without it a 404 from a retired model, a 400 from a rejected key
 * and a 429 are indistinguishable. See ADR-0004 and ADR-0006.
 */
export type AiFailure =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number; readonly body: string }
  | { readonly kind: 'shape'; readonly message: string };

/** Per-event verdict. `source` records whether the AI answered or rules did. */
export interface EventSummary {
  readonly summaryJa: string;
  readonly categories: ReadonlyArray<string>;
  readonly difficulty: Difficulty;
  readonly reasonJa: string;
  readonly source: 'ai' | 'rule';
  /** Set only when the AI was tried and failed. Absent when no API key is set. */
  readonly aiFailure?: AiFailure;
}

export interface DigestConfig {
  /** Look-ahead window in days. */
  readonly days: number;
  /** Drop onsite events. */
  readonly onlineOnly: boolean;
  /** Keep events with entry restrictions (Prequalified, Academic, ...). */
  readonly includeRestricted: boolean;
  /** Minimum CTFtime weight. Unrated (weight 0) events bypass this. */
  readonly weightMin: number;
  /** Hard cap on events per digest. */
  readonly maxEvents: number;
}

export interface DiscordEmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface DiscordEmbed {
  readonly title?: string;
  readonly url?: string;
  readonly description?: string;
  readonly color?: number;
  readonly fields?: ReadonlyArray<DiscordEmbedField>;
  readonly thumbnail?: { readonly url: string };
  readonly footer?: { readonly text: string };
}

export interface DiscordMessage {
  readonly content?: string;
  readonly embeds?: ReadonlyArray<DiscordEmbed>;
}

export interface DateWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface Env {
  readonly CONFIG: KVNamespace;
  readonly AI_BASE_URL: string;
  readonly AI_MODEL: string;
  readonly AI_API_KEY: string;
  readonly CTFTIME_USER_AGENT: string;
  readonly DISCORD_WEBHOOK_URL: string;
  readonly DISCORD_PUBLIC_KEY: string;
  readonly DISCORD_APP_ID: string;
}
