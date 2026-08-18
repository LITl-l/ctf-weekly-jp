# ADR-0005: Defer multi-guild support and any store beyond KV

- Status: Deferred
- Date: 2026-08-19

## Context

The bot posts to one channel via one webhook and keeps one configuration object
in Workers KV. A natural next step would be per-guild configuration, which
implies per-guild storage, keying, and a way for each guild to register its own
destination channel.

Nothing currently asks for this. It is a single-server bot for a single group.

## Decision

Do not build it. One configuration object, one webhook, one channel.

Revisit when **any** of these becomes true:

1. **A second Discord server needs its own filters.** Sharing one config across
   two guilds is the trigger, not merely being installed in two.
2. **KV writes approach 1,000/day** (the free-tier ceiling). Current usage is a
   handful of writes per week, entirely from `/ctf config set`. Per-guild
   configuration multiplies writes by guild count; at that ceiling, KV is no
   longer the right store and D1 should be evaluated.
3. **More than 3 cron schedules are needed** (the free-tier per-Worker cap).
   Per-guild scheduling would hit this at the fourth guild.

Until then, the default is: KV, one key, one destination.

## Consequences

- Configuration reads and writes stay a single key with no partitioning, so
  `loadConfig` cannot fail in a guild-specific way.
- If trigger 1 fires first, the migration is a keyspace change (`config` →
  `config:<guild_id>`) plus a destination lookup, and the pipeline itself is
  unaffected because it already takes config as a parameter.
- Choosing D1 now would add a schema, migrations, and a binding to store one
  object of five scalar fields.

## Rejected alternatives

- **Building multi-guild support upfront** — a schema and keyspace designed
  against zero real second-guild requirements.
- **Durable Objects for config** — solves coordination this bot does not have;
  a weekly cron and occasional slash command have no contention.
