---
description: "Procedure for the weekly usage review: reading the agent's own turns back out of its wide events, comparing the last full week against the one before it, and saying what drove the change. Load when the cost-watchdog schedule fires, or when asked how many turns the agent ran, how many tokens it took, or whether a surface got heavier. It counts tokens, never dollars. Not for questions about Vercel platform usage, which this agent does not read."
---

# Cost watchdog

What did this agent do last week, and how much did it take? Both numbers come from `usage_report`, which reads the wide events the agent wrote about itself. There is no other source: the model answers through a gateway, so Vercel sees no model usage for these runs at all.

## Before you start

Two things can be missing, and each one changes the report rather than ending it.

- **No `usage_report` tool in this session.** `POSTHOG_PERSONAL_API_KEY` or `POSTHOG_PROJECT_ID` is not configured, so nothing can be read back. Say exactly that in one line and stop. Do not estimate.
- **The tool answers with a PostHog error.** Report it as it came, with the status. A 401 is the key, a 403 is its scopes or its project, a 404 is `POSTHOG_PROJECT_ID`. Naming which one saves the maintainer the round trip; guessing at numbers instead does not.

## The window

The last full week, Monday through Sunday, ending before today. Call `usage_report` twice: once for that week, once for the week before it, so every number has something to be compared against. `until` is exclusive, so pass the Monday after the week you want.

## What to report

Three lines, in this order, and nothing that repeats a number already given.

1. **Volume.** Turns last week against the week before, as a count and a direction. A week with no turns is a finding: the agent was idle, or a webhook stopped arriving.
2. **Tokens.** Input and output, with the ratio to turns. Input tokens per turn climbing is the number that matters most: it means context is growing, which is what a bloated tool list or an instruction that should be a skill looks like from the outside.
3. **Failures.** Failed turns, with the count from the week before.

Then one line of interpretation, only when the data supports one: what changed and the most plausible reason from what you can see. When nothing moved, say so and stop. A steady week is the normal outcome and does not need paragraphs.

## Proposing a change

A finding earns a proposal only when it is grounded in a number you just read.

- Input tokens per turn up without more turns: something is now carried in every prompt that was not before. Name the candidate (a tool set that grew, a fragment that grew, a skill that should not be always-on) and offer to look.
- Failed turns up: that is an incident lead, not a usage item. Say which day.
- A model change is the maintainer's call, and this agent's model is set by the `MODEL` environment variable rather than in code. Propose, never assume.

## What not to do

- Do not turn a token count into a dollar figure. The report carries no price, and a rate from memory is a number the next report cannot reproduce.
- Do not compare against a week you did not query.
- Do not open a pull request from this sweep. It reports; the change it proposes is someone else's decision.
