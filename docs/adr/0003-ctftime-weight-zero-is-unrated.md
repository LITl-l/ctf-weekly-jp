# ADR-0003: A CTFtime weight of 0 means unrated, and is never reported as beginner-friendly

- Status: Accepted
- Date: 2026-08-18

## Context

The product's headline feature is telling a Japanese beginner whether an event
suits them. CTFtime publishes a `weight` per event — its own rating of the
event's calibre — and weight is the strongest numeric signal available.

Weight is also 0 for any event CTFtime has not rated, which includes every
brand-new CTF. In a live 7-day sample, 5 of 7 events carried weight 0. Unrated
is the common case, not an edge case. One of them, `CTFZone 2026`, is an onsite
event with a 300,000 RUB first prize.

Read naively, `0` sorts below every "easy" event and reads as easiest of all.

## Decision

Weight 0 maps to the distinct value `unknown`, rendered `⚪ 未評価`. It is never
rendered as `初心者向け`.

This holds in three places:

1. **Filtering** — unrated events bypass the `weight_min` filter entirely rather
   than being treated as below it. Raising `weight_min` must not silently hide
   every new CTF.
2. **Rule-based verdicts** — `weight == 0 → unknown` precedes all other rules.
   The remaining thresholds are `<25 beginner`, `<50 intermediate`, else `advanced`.
3. **The AI prompt** — the prompt states that 0 means unrated and instructs the
   model to answer `unknown` unless the event's own description explicitly
   signals a beginner audience. The weight is passed to the model annotated
   `(未評価)`, not as a bare number.

Every difficulty shown is labelled with its provenance: `AI推定` when the model
answered, `自動判定` when rules did.

## Consequences

- The digest says "I don't know" often, and that is the intended behaviour. A
  confident wrong answer sends a beginner to an event well beyond them; an
  honest `未評価` costs them one click to the event page.
- A description that genuinely says "for first-timers" still reaches `beginner`
  through the AI path, so real beginner events are not lost to caution.
- Difficulty is an estimate and is never presented as fact. The embed footer
  says so on every event.

## Rejected alternatives

- **Treating weight as a plain scale** — one line of code, and wrong for the
  majority of events in a typical week.
- **Dropping unrated events** — would hide most of each week's CTFs, including
  the small new ones most likely to welcome beginners.
- **Inferring difficulty from the title and description alone** — an LLM asked
  "is this beginner friendly?" with thin input answers confidently regardless.
  Grounding on weight, format, restrictions, duration and participant count is
  what makes the estimate worth showing.
