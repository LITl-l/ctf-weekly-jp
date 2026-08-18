# ADR-0002: Treat the AI provider as an OpenAI-compatible URL, not a vendor

- Status: Accepted
- Date: 2026-08-18

## Context

Each event needs translation, summarisation, category guessing, and a difficulty
call in one pass — roughly 15 model calls a week. The budget for this is zero.
Free tiers are the target, and they change terms, models, and availability
faster than this project will be maintained.

## Decision

The provider is three environment variables:

```
AI_BASE_URL   e.g. https://api.mistral.ai/v1
AI_MODEL      e.g. mistral-small-latest
AI_API_KEY
```

The code posts an OpenAI-shaped `POST {AI_BASE_URL}/chat/completions` and reads
`choices[0].message.content`. No vendor SDK, and no per-vendor branch anywhere in
the codebase.

Default is Mistral's Experiment tier because its allowance renews monthly.
NVIDIA NIM (`integrate.api.nvidia.com/v1`), Groq, OpenRouter, and a local
`llama-server` are all reachable by changing the two non-secret variables.

When no `AI_API_KEY` is set, the network is never touched and every event falls
back to the rule-based verdict of [ADR-0003](0003-ctftime-weight-zero-is-unrated.md).

## Consequences

- Switching provider is a config change, not a code change. Nothing about a
  vendor's naming, auth scheme, or response envelope leaks past `src/ai.ts`.
- `response_format: {type: "json_object"}` is **not** universally supported;
  some NVIDIA NIM models reject it with 400. A 400 triggers exactly one retry
  with the flag removed. Without this, a rejecting provider would send every
  event down the rule-based path *silently* — a digest that looks healthy while
  the AI never ran once.
- The model's JSON is validated before use, and any failure degrades to rules
  rather than propagating. An unparseable response costs one event its summary,
  never the whole digest.
- Free tiers differ in the wrong direction over time. NVIDIA's 1,000 credits are
  one-time, not renewing, which is why it is documented but not the default.

## Rejected alternatives

- **A vendor SDK (`@mistralai/mistralai`, `openai`)** — adds a runtime
  dependency and a supply-chain surface to save one `fetch` call, and would have
  to be swapped wholesale to change provider.
- **A provider interface with one implementation per vendor** — Mistral, NIM,
  Groq, and OpenRouter already share a wire format. Implementations would be
  copies of each other differing only in a base URL.
- **Cloudflare Workers AI** — no third-party key at all and appealing for that,
  but Japanese output quality from the available models is the weakest of the
  options, and Japanese output is the product.
