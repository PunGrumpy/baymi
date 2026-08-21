---
description: "Procedure for the weekly usage and cost review: reading the agent's own turns back out of its wide events, comparing the last full week against the one before it, and saying what drove the change. Load when the cost-watchdog schedule fires, or when asked what the agent has been spending, how many turns it ran, or whether a surface got more expensive. Not for questions about Vercel platform usage, which this agent does not read."
---

# Cost watchdog

What did this agent do last week, and what did it cost? Both numbers come from `usage_report`, which reads the wide events the agent wrote about itself. There is no other source: the model answers through a gateway, so Vercel reports no cost for these runs at all.

## Before you start

Two things can be missing, and each one changes the report rather than ending it.

- **No `usage_report` tool in this session.** `POSTHOG_PERSONAL_API_KEY` or `POSTHOG_PROJECT_ID` is not configured, so nothing can be read back. Say exactly that in one line and stop. Do not estimate.
- **The tool answers with a PostHog error.** Report it as it came, with the status. A 401 is the key, a 403 is its scopes or its project, a 404 is `POSTHOG_PROJECT_ID`. Naming which one saves the maintainer the round trip; guessing at numbers instead does not.
- **The tool returns rows with `costUsd: 0`.** `MODEL_COST_PER_MTOK` was not configured when those turns ran, so the price of a token was unknown. Report tokens and turns, say the dollar column is unavailable and why, and do not convert tokens to dollars yourself, not even from `listedPricePerMTok`: a price applied after the fact to turns that were never costed is a number the next report cannot reproduce.

## Where the price comes from

`usage_report` answers with two prices, and they are not the same thing.

- `appliedPricePerMTok` is what the rows were costed at, applied to each turn as it happened, from `MODEL_COST_PER_MTOK`. Quote this one for the period, because it is the one the numbers were built from.
- `listedPricePerMTok` is what OpenRouter publishes for the model right now, read fresh on every run, with the provider that publishes it.

When they differ, say so in one line with both numbers. The week's cost still stands; the configured rate is what is now wrong, and only for the next week. Propose the update and leave the change to the maintainer, since the endpoint actually being billed may not be the one OpenRouter lists.

When `listedPricePerMTok` is null, the price could not be confirmed on this run: no `OPENROUTER_MODEL_SLUG`, a slug OpenRouter does not carry, or OpenRouter being unreachable. Report the applied price and say it is unconfirmed. Never fill that gap from memory, because a model's price is exactly the kind of fact that moved since you last saw it.

## The window

The last full week, Monday through Sunday, ending before today. Call `usage_report` twice: once for that week, once for the week before it, so every number has something to be compared against. `until` is exclusive, so pass the Monday after the week you want.

## What to report

Four lines, in this order, and nothing that repeats a number already given.

1. **Volume.** Turns last week against the week before, as a count and a direction. A week with no turns is a finding: the agent was idle, or a webhook stopped arriving.
2. **Tokens.** Input and output, with the ratio to turns. Input tokens per turn climbing is the number that matters most: it means context is growing, which is what a bloated tool list or an instruction that should be a skill looks like from the outside.
3. **Cost**, when the price is configured. Total, and per turn. It is tokens multiplied by a configured list price, so call it an estimate: the endpoint may charge something else, and a cached input token bills lower than the rate applied here, which makes the figure an upper bound on a week with heavy prompt caching.
4. **Failures.** Failed turns, with the count from the week before.

Then one line of interpretation, only when the data supports one: what changed and the most plausible reason from what you can see. When nothing moved, say so and stop. A steady week is the normal outcome and does not need paragraphs.

## Proposing a change

A cost finding earns a proposal only when it is grounded in a number you just read.

- Input tokens per turn up without more turns: something is now carried in every prompt that was not before. Name the candidate (a tool set that grew, a fragment that grew, a skill that should not be always-on) and offer to look.
- Failed turns up: that is an incident lead, not a cost item. Say which day.
- A model change is the maintainer's call, and this agent's model is set by the `MODEL` environment variable rather than in code. Propose, never assume.

## What not to do

- Do not quote a price you did not read out of `usage_report`.
- Do not report a token count as a dollar figure by applying rates from memory.
- Do not compare against a week you did not query.
- Do not open a pull request from this sweep. It reports; the change it proposes is someone else's decision.
