# ctf-weekly-jp — working notes

A Cloudflare Worker that posts a weekly Japanese digest of upcoming CTFtime
events to Discord, with AI-estimated beginner difficulty. Read `docs/adr/` for
why it is shaped this way.

## Running anything

There is no global Node on the development machine. Every command goes through
Nix:

```bash
nix shell nixpkgs#nodejs_22 --command npm test
nix shell nixpkgs#nodejs_22 --command npm run typecheck
nix shell nixpkgs#nodejs_22 --command npm run dryrun
```

`nix develop` is provided by `flake.nix` for humans, but **it fails in this
repo when files are untracked** — flakes only see git-tracked files, and this is
a colocated jj repo where new files stay untracked until a commit. Use
`nix shell nixpkgs#nodejs_22 --command` for scripted work.

`npm run dryrun` hits the real CTFtime API, runs the real pipeline, and prints
the digest to stdout. It posts nothing to Discord and needs no secrets. It is
the fastest way to see whether a change actually works. `MAX_EVENTS=1` and
`DAYS=n` narrow it.

## Layout

```
src/result.ts        Result<T,E> and helpers — no dependencies
src/types.ts         Domain types (all readonly) and Env
src/text.ts          HTML stripping, entity decoding, truncation
src/ctftime.ts       CTFtime API access
src/filter.ts        Config-driven event filtering
src/difficulty.ts    Rule-based verdicts and difficulty labels
src/ai.ts            OpenAI-compatible summariser
src/render.ts        Japanese Discord embeds
src/config.ts        KV-backed config, defaults and validation
src/pipeline.ts      Composes the above
src/discord/         Signature verification, webhook, slash commands
src/index.ts         Worker entry: scheduled() + fetch(). The only impure shell.
```

## Invariants — breaking these breaks the product

- **CTFtime 403s without a `User-Agent`.** Verified by probe: absent UA → 403,
  custom UA → 200. Never drop `CTFTIME_USER_AGENT`.
- **`weight: 0` means unrated, not easy.** Most events in a typical week are
  unrated. See ADR-0003; it is enforced in filtering, in the rules, and in the
  prompt.
- **Discord kills any interaction not acknowledged within 3 seconds.** Anything
  slower must return a deferred response and finish in `ctx.waitUntil()`.
- **Discord rejects a message whose embeds total more than 6000 characters.**
  Per-field caps are not enough: ten individually legal embeds still add up to a
  400, and because `postMessages` stops at the first failure, the message
  carrying the header takes every later one down with it. `buildMessages` packs
  by both limits and the tests assert the sum, not just the parts.
- **Nothing read back from KV or CTFtime is trusted.** A cast is not a check;
  both are validated at the module edge so an invalid date can never reach
  `Intl.DateTimeFormat`, which throws.
- **Never post nothing.** Zero matches, a CTFtime outage, and a total AI failure
  each produce a message. Silence is indistinguishable from a broken bot.
- **An AI failure never drops an event.** It falls back to a rule-based verdict,
  labelled `自動判定` so readers know the difference.
- **Errors are values.** Fallible functions return `Result`; `try/catch` only
  adapts throwing platform APIs at a module edge. See ADR-0004.
- **Zero runtime dependencies.** `package.json` has no `dependencies` block and
  should not grow one.

## Conventions

- Domain types are `readonly`; transformations return new values.
- Effects (`fetch`, KV) are injected, never imported into the pure core. This is
  why the whole pipeline is testable with no network.
- User-facing strings are Japanese. Code, comments, and ADRs are English.

## Tests

`test/fixtures/ctftime.json` is a real CTFtime response captured 2026-08-18.
Do not hand-edit it to make a test pass — its value is that it contains shapes
nobody would invent (HTML in descriptions, `weight: 0` everywhere, restriction
values like `Casual`). Capture a fresh one instead if the API changes.

`test/ai.integration.test.ts` runs a real HTTP server on a real socket. It
catches URL, header, and body faults that a mocked `fetch` cannot.

## Not to touch

- `docs/adr/*` are immutable records. Supersede an ADR with a new one; do not
  rewrite a decision after the fact.
- `docs/superpowers/` is gitignored scratch space for planning notes. Nothing
  there is a deliverable and none of it belongs on `main`.
