# ADR-0006: Default to a pinned `gemini-3.5-flash-lite`, chosen by its thinking budget

- Status: Accepted
- Date: 2026-11-01
- Amends: [ADR-0002](0002-openai-compatible-ai-provider.md), default provider only

## Context

ADR-0002 made the provider three environment variables and recorded: "Default is
Mistral's Experiment tier because its allowance renews monthly." That contract is
unchanged, and it is what keeps this amendment a two-variable edit.

Two things moved underneath it:

- No Mistral key is held for this project, so the documented default is one
  nobody here can run.
- `gemini-2.5-flash` now answers `404`: "This model models/gemini-2.5-flash is no
  longer available to new users." This is the provider drift ADR-0002
  anticipated — free tiers change models faster than this project is maintained.

Gemini publishes an OpenAI-compatible endpoint at
`https://generativelanguage.googleapis.com/v1beta/openai/`, which `src/ai.ts`
already reaches unmodified; it strips the trailing slash before appending
`/chat/completions`.

### The constraint that decides the model

`src/ai.ts` sends `max_tokens: 700`, hardcoded. On Gemini that maps to
`max_output_tokens`, which **covers thought tokens as well as output tokens**.
Exhausting it yields `finish_reason: "incomplete"` with output truncated or
empty. This codebase would correctly degrade that to a rule-based verdict — and
would do so for every event, every week, indefinitely.

Model choice is therefore not a free configuration change. Only a model whose
default thinking level is `minimal` fits inside 700 tokens without a code
change. The model is coupled to a constant in `src/ai.ts`.

## Decision

The default provider is Gemini, with the model pinned:

```
AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
AI_MODEL    = "gemini-3.5-flash-lite"
```

`gemini-3.5-flash-lite` defaults to thinking level `minimal` and so fits the
existing 700-token budget with no code change.

The model name is pinned, **not an alias**. `gemini-flash-lite-latest` resolves
to whatever Google points it at next; a model with a higher thinking default
would spend the 700-token budget on thought and return empty output. The failure
mode of an alias is a digest that falls back to rules for every event while
nothing in this repository changed. A pin turns that silent drift into an
explicit edit.

Measured with a real key at `AI_CONCURRENCY = 3`:

```
DAYS=30 npm run dryrun
events: 15 | summaries: {"ai":15} | 6354ms
```

Fifteen consecutive calls, no 429. ADR-0003 held: weight-0 events stayed
`⚪ 未評価` unless the description stated beginner-friendliness explicitly.

6.35s for 15 events sits inside both deadlines, and the binding one is the slash
command rather than the cron. `/ctf next` finishes inside `ctx.waitUntil()`,
capped at 30s of wall clock, while `scheduled()` gets 15 minutes. `max_events`
is capped at 50 in `src/config.ts`, roughly 21s at that ceiling: about 4.7x
margin at the measured size, and still inside the cap at the maximum.

## Consequences

- Switching away remains a two-variable edit, as ADR-0002 intended. Nothing
  about Gemini leaks past `src/ai.ts`, and no vendor branch was added.
- `max_tokens` is now a provider-compatibility constraint rather than a tuning
  knob. Adopting a model with a higher thinking default requires raising it and
  sending an explicit `reasoning_effort`; the two travel together.
- A retired model announces itself as a `404` whose body names the replacement.
  That is only actionable if the status and body survive, so `summarizeEvent`
  carries the failure as data on the rule-based summary and `npm run dryrun`
  prints it grouped. Previously a retired model, a rejected key and a rate limit
  were indistinguishable — all three read as `summaries: {"rule":15}`.
- Gemini's free-tier request quotas are deliberately not recorded here. They were
  not measured. The only measurement is the absence of a 429 across 15 calls at
  concurrency 3.
- Mistral, NVIDIA NIM, Groq and a local `llama-server` stay documented and
  reachable. None is affected by this.

## Rejected alternatives

- **`gemini-3.8-flash`** — its default thinking level is `medium` and it offers
  no `minimal` level, so thinking cannot be disabled. Using it means sending
  `reasoning_effort` and raising the hardcoded `max_tokens`, converting a
  configuration change into a code change. It is the model Google's own 404 body
  recommends, which is not by itself a reason to take it.
- **`gemini-flash-lite-latest`** — an alias can roll onto a model with a
  different thinking default and exceed the 700-token budget with no edit here.
  Total silent degradation to rules is the worst failure mode available, because
  the digest still posts and still looks healthy.
- **Staying on Mistral** — no key is held, so the default would stay unrunnable.
  `gemini-2.5-flash`'s retirement is not an argument for Mistral; it is an
  argument that any pinned free-tier model is a standing maintenance item.
- **Raising `max_tokens` to accommodate a thinking model** — spends budget on
  tokens no reader ever sees. The output is one short Japanese summary, a
  category list and a difficulty label; 700 tokens is already generous.
