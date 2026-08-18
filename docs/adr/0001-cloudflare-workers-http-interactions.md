# ADR-0001: Run on Cloudflare Workers, and speak Discord over HTTP Interactions

- Status: Accepted
- Date: 2026-08-18

## Context

The product is a weekly push: once a week, fetch CTFtime, summarise, post to a
Discord channel. It must cost nothing to run, and it must fire reliably whether
or not any particular machine is switched on. A secondary requirement is that
the digest's filters be adjustable from inside Discord.

## Decision

Host the whole thing as a single Cloudflare Worker.

- The weekly push runs from a **Cron Trigger** (`0 0 * * 1` UTC = Monday 09:00 JST).
- The Discord bot is implemented with **HTTP Interactions**: Discord POSTs
  slash commands to `/interactions`, verified by Ed25519 signature.
- Runtime configuration lives in **Workers KV** under a single key.

`/ctf next` answers with a **deferred response (type 5)** and completes the work
inside `ctx.waitUntil()`, editing the placeholder afterwards.

## Consequences

- No always-on process, no container, no server. Free plan covers it: Cron
  Triggers are included (3 per Worker), KV allows 1K writes/day, and the 10ms
  CPU cap is not binding because nearly all elapsed time is I/O wait, which does
  not count as CPU time.
- Cron and slash commands share one pipeline and one config store, so a manual
  run and the weekly run cannot diverge.
- Discord invalidates any interaction not acknowledged within 3 seconds, and the
  interaction token then stays valid for 15 minutes. A digest takes far longer
  than 3 seconds, so the deferred-response path is mandatory, not an
  optimisation. Any future command that does real work must defer as well.
- Long digests exceed Discord's 10-embeds-per-message cap and are split across
  sequential messages.

## Rejected alternatives

- **Gateway (WebSocket) bot** — Workers are request-scoped and cannot hold a
  persistent gateway connection. Emulating one with Durable Objects would add
  cost and a always-on component for zero benefit: nothing here needs to observe
  message events.
- **Local systemd timer on the developer's machine** — the machine is WSL2.
  `Persistent=true` only catches up at next boot, so a weekly fire can land days
  late or never. Reliability was the point of choosing a host at all.
- **GitHub Actions cron** — reliable and free, but it cannot serve slash
  commands, which would force a second component for the interactive half.
