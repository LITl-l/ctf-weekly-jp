# ctf-weekly-jp — Design Spec

Date: 2026-08-18
Status: Implemented (75 tests green, live dry run verified)

## Purpose

A Discord bot that posts a weekly digest of upcoming CTF events from CTFtime,
in Japanese. Each event gets an AI-written summary, its likely challenge
categories, and an AI-estimated beginner-friendliness rating.

## Constraints

- **No Python.** TypeScript only. Non-TS files are limited to `wrangler.toml`,
  the Nix flake, and JSON config.
- **Free hosting.** Cloudflare Workers free plan: Cron Triggers (up to 3 per
  Worker), 100K requests/day, KV at 1GB / 100K reads / 1K writes per day.
  The 10ms CPU cap is not binding — nearly all elapsed time is I/O wait on
  CTFtime and the AI API, which does not count as CPU time.
- **Free AI API.** Default Mistral La Plateforme (Experiment tier, renewing
  ~1B tokens/month). NVIDIA NIM (`integrate.api.nvidia.com/v1`, 1000 one-time
  credits, 40 RPM) is a drop-in alternative.
- **No global Node install** on the dev machine. A Nix flake devShell provides
  node + wrangler.

## Verified Facts

- CTFtime API returns **403 without a custom `User-Agent`**; a custom UA
  returns 200. Confirmed by direct probe on 2026-08-18.
- Event schema (verified against live response):
  `id, ctf_id, ctftime_url, title, description, url, logo, start, finish,
   duration{hours,days}, weight, participants, format, format_id, onsite,
   location, restrictions, organizers[{id,name}], prizes, live_feed,
   is_votable_now, public_votable`
- `weight: 0` means **unrated**, not easy. Live example: `CTFZone 2026`
  carries `weight: 0` and is an onsite Russian event with cash prizes.

## Architecture

Single Cloudflare Worker with two entrypoints sharing one core pipeline.

```
scheduled()  — cron: Mon 09:00 JST (Sun 00:00 UTC)  ─┐
fetch()      — POST /interactions (slash commands)  ─┴─► pipeline
```

### Pipeline

```
loadConfig(KV) → fetchEvents(CTFtime) → filter → summarize(AI, per event)
              → render(embeds, JA) → post(Discord webhook)
```

### Module layout

```
src/
  index.ts              Worker entry: scheduled() + fetch()
  pipeline.ts           Orchestrates the run; used by both entrypoints
  ctftime.ts            API fetch, custom UA, window calc, response typing
  filter.ts             Config-driven event filtering
  ai.ts                 OpenAI-compatible chat call → validated JSON
  difficulty.ts         Rule-based fallback + weight-0 handling
  render.ts             Discord embed construction (Japanese, JST)
  text.ts               HTML stripping, entity decoding, truncation
  config.ts             KV-backed config: defaults + overrides
  discord/
    verify.ts           Ed25519 interaction signature verification
    interactions.ts     Slash command routing + deferred responses
    webhook.ts          Channel webhook POST
scripts/
  register-commands.ts  One-shot slash command registration
test/
  fixtures/ctftime.json Real captured API response
  *.test.ts
wrangler.toml
flake.nix
```

Each module has a single responsibility and is testable in isolation. `ai.ts`
knows nothing about Discord; `render.ts` knows nothing about CTFtime's wire
format; `pipeline.ts` is the only place they meet.

## Data Flow Detail

### 1. Fetch (`ctftime.ts`)

`GET https://ctftime.org/api/v1/events/?limit=100&start=<now>&finish=<now+Ndays>`
with `User-Agent: ctf-weekly-jp/1.0 (+<repo url>)`.

Unix-second timestamps. Response is an array; normalize into an internal
`CtfEvent` type so downstream modules never touch raw API shapes.

### 2. Filter (`filter.ts`)

Config keys, all runtime-adjustable via slash command:

| Key | Default | Meaning |
|---|---|---|
| `days` | 7 | Look-ahead window |
| `online_only` | true | Drop `onsite: true` events |
| `include_restricted` | false | Drop non-Open/Public `restrictions` |
| `weight_min` | 0 | Minimum weight; weight-0 events always kept (unrated ≠ low) |
| `max_events` | 15 | Cap per digest, sorted by start time |

### 3. Summarize (`ai.ts`)

One call per event. OpenAI-compatible chat completions, `response_format`
JSON. Configured entirely by env: `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`.

Input given to the model (grounding — the title alone is not enough signal):
`title, description, format, restrictions, onsite, location, weight,
participants, duration, organizer names, prizes`.

Required output schema:

```json
{
  "summary_ja": "2-3 sentence Japanese summary",
  "categories": ["pwn", "web", "crypto", "rev", "forensics", "misc", "osint", "hardware", "blockchain"],
  "difficulty": "beginner | intermediate | advanced | unknown",
  "reason_ja": "one-line Japanese justification for the difficulty call"
}
```

The prompt states explicitly that `weight: 0` means unrated and must produce
`difficulty: "unknown"` unless the description itself clearly signals the level
(e.g. "for beginners", "high school students").

Responses are validated against the schema before use. Invalid or failed
responses fall through to `difficulty.ts`.

### 4. Difficulty fallback (`difficulty.ts`)

Deterministic rules used when the AI call fails or returns invalid JSON:

- `weight == 0` → `unknown`
- `weight < 25` → `beginner`
- `weight < 50` → `intermediate`
- otherwise → `advanced`

Events falling back are marked so the embed can say the estimate is
rule-based rather than AI-generated.

### 5. Render (`render.ts`)

One Discord embed per event, Japanese, times converted to JST.

Difficulty display:

| Value | Label |
|---|---|
| beginner | 🟢 初心者向け |
| intermediate | 🟡 中級 |
| advanced | 🔴 上級 |
| unknown | ⚪ 未評価 |

Embed fields: 開催期間 (JST) / 形式 / 参加条件 / 重み / 予想ジャンル /
難易度（AI推定）+ 理由 / リンク. Embed color keyed to difficulty. Footer
carries `AI推定 · CTFtime調べ` so readers never mistake the estimate for fact.

A header message precedes the embeds: `今週のCTF（M月D日〜M月D日）— N件`.

Discord caps 10 embeds per message, so batches of 10 are sent sequentially.

### 6. Post (`discord/webhook.ts`)

POST to `DISCORD_WEBHOOK_URL`. Honors 429 `retry_after`.

## Slash Commands

HTTP Interactions, not gateway — Workers cannot hold a persistent WebSocket.

- `/ctf next` — run the digest on demand
- `/ctf config show` — print current config
- `/ctf config set <key> <value>` — write to KV, validated against key table
- `/ctf config reset` — clear overrides, revert to defaults

**Deferred response is mandatory.** Discord requires an ACK within 3 seconds
and the AI work takes far longer. `/ctf next` replies immediately with type 5
(`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`), performs the run inside
`ctx.waitUntil()`, then PATCHes
`/webhooks/{app_id}/{token}/messages/@original`. Config commands are fast
enough to answer inline.

Every interaction request is Ed25519-verified against `DISCORD_PUBLIC_KEY`
using WebCrypto before any processing; unverified requests get 401.

## Error Handling

No failure is silent — the channel always learns what happened.

- **CTFtime unreachable / non-200**: one retry after a short backoff, then post
  a brief Japanese error notice to the channel.
- **Zero events after filtering**: post `今週は該当するCTFがありません` rather
  than posting nothing, so silence never means "the bot is broken".
- **AI call fails for one event**: fall back to rule-based difficulty, keep the
  English title and a truncated description, mark the estimate as rule-based.
  The event is never dropped.
- **AI fails for every event**: still post the digest, fully rule-based, with a
  notice that summaries were unavailable.
- **Discord POST fails**: retry per `retry_after` on 429; log and give up
  otherwise (nowhere left to report to).

## Testing

Plain vitest on the node environment. The workers pool was dropped: every
unit under test is a pure function or a `fetch` caller, so the pool added
version-coupling without adding coverage.

- `filter.test.ts` — each config key, including that weight-0 survives `weight_min`
- `difficulty.test.ts` — every rule boundary, especially weight 0 → unknown
- `render.test.ts` — embed shape, JST conversion, 10-embed batching, label mapping
- `verify.test.ts` — signature verification accepts valid, rejects tampered
- `ai.test.ts` — schema validation accepts good JSON, rejects malformed
- `pipeline.test.ts` — end-to-end with mocked fetch against the real fixture
- `text.test.ts` — HTML tags and entities in real CTFtime descriptions
- `ai.integration.test.ts` — the adapter against a real HTTP server on a real
  socket, which catches URL/header/body faults a mocked fetch cannot

The fixture is a genuine CTFtime response captured 2026-08-18, so tests run
against real-world shapes rather than invented ones.

## Configuration & Secrets

`wrangler.toml` vars: `AI_BASE_URL`, `AI_MODEL`, `CTFTIME_USER_AGENT`.
Secrets via `wrangler secret put`: `AI_API_KEY`, `DISCORD_WEBHOOK_URL`,
`DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`.

KV namespace `CONFIG` holds runtime overrides under a single `config` key.

Cron: `0 0 * * 1` (UTC) = Monday 09:00 JST.

## Out of Scope (YAGNI)

- Per-guild configuration — single channel, single config
- Event reminders before start
- Team/participation tracking
- Writeup aggregation
- Localization beyond Japanese

## Implementation Notes (as built)

Two defects surfaced only once the pipeline ran against live data, and both are
now covered by tests:

1. **CTFtime descriptions contain author-written HTML.** `<b>Welcome to
   BrunnerCTF 2026.</b>` reached the embed verbatim; Discord renders markdown,
   not HTML, so readers saw the literal tags. `text.ts` strips tags and decodes
   entities before anything reaches an embed or an AI prompt.

2. **response_format is not universally supported.** Some OpenAI-compatible
   endpoints (certain NVIDIA NIM models) reject
   `response_format: {type: "json_object"}` with a 400. Without handling, every
   event would fall back to rules *silently* — a digest that looks healthy while
   the AI never ran. `ai.ts` retries once without the flag; the system prompt
   already demands bare JSON.

Verified on 2026-08-18: 75 tests passing, `tsc --noEmit` clean, and a live dry
run rendering 6 real events in 382ms.
