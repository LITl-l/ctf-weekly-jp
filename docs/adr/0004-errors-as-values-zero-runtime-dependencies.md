# ADR-0004: Errors are values, data is immutable, and there are no runtime dependencies

- Status: Accepted
- Date: 2026-08-19

## Context

This code runs unattended once a week. Nobody watches it. Every failure mode it
has — CTFtime down, CTFtime rate-limiting, an AI provider rejecting a parameter,
a model emitting prose instead of JSON, Discord returning 429 — is a *normal*
weekly occurrence, not an exceptional one.

Exceptions make those paths invisible at the call site: a function's signature
says `Promise<CtftimeEvent[]>` whether or not it can blow up, and the compiler
never asks the caller about it.

## Decision

**Errors are values.** Fallible operations return `Result<T, E>`
(`{ok: true, value} | {ok: false, error}`, defined in `src/result.ts`). Failures
are tagged unions — `{kind: 'http', status} | {kind: 'network', message} |
{kind: 'shape', message}` — not `Error` subclasses. `try/catch` appears only
where it adapts a throwing platform API (`fetch`, `JSON.parse`, WebCrypto) into
a `Result`, at the edge of a module.

**Data is immutable.** Domain types are `readonly` with `ReadonlyArray` fields.
Transformations return new values; no function mutates its arguments.

**The core is pure; effects live at the edges.** `filter`, `difficulty`,
`render`, `text`, and `config`'s validation are total functions of their inputs,
with no I/O and no clock. `fetch` and KV access are injected, which is why the
whole pipeline is testable without a network.

**No runtime dependencies.** `package.json` has zero `dependencies`; everything
under `devDependencies` is tooling. `Result` is ~40 lines of local code rather
than fp-ts.

## Consequences

- Every failure path is visible in a type signature, and the compiler forces
  each caller to handle it. The silent-degradation bug described in
  [ADR-0002](0002-openai-compatible-ai-provider.md) is the exact class of defect
  this prevents.
- Tests exercise real logic with injected `fetch`, so a mocked network is a
  one-line substitution rather than a framework.
- Two deliberate exceptions, both documented in place: `mapWithConcurrency`
  keeps a mutable cursor inside its closure — it is referentially transparent
  from the outside, and the obvious functional alternative (partitioning work
  into fixed lanes) would let one slow request block its whole lane, which
  matters when free-tier latency varies wildly. `summarizeEvent` catches rather
  than threading a `Result`, because its contract is total: every failure
  becomes a rule-based verdict, so it cannot fail.
- Zero dependencies means no supply-chain surface in the deployed artifact, no
  version drift on a project touched a few times a year, and a Worker bundle
  that is essentially the source.

## Rejected alternatives

- **fp-ts / Effect** — a runtime dependency and a large idiom to import for a
  project whose entire domain is six pure modules. `Result` is the only
  abstraction actually needed.
- **Exceptions with a top-level handler** — works, but erases which operation
  failed and makes partial success (13 of 15 events summarised) awkward to
  express. Partial success is the normal outcome here.
- **Point-free composition throughout** — uniformly functional, but produces
  worse stack traces in a Workers runtime and reads as unidiomatic TypeScript to
  the next maintainer.
