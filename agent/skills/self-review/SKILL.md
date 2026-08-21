---
description: "Playbook for the weekly pass over this agent's own surface, in two halves: what has drifted out of coherence (a capability wired but never reached, a fragment promising a tool that is gone, a lib module nothing imports) and what is missing (a capability worth having, a manual step worth automating). Load when the self-review schedule fires, or when asked for a self-review, an audit of the agent itself, or what Baymi should do next. Not for auditing the repository's documentation, which is the repo-health-sweep skill."
---

# Self review

Two halves, run together, because they fail in opposite directions. Skip the second and this becomes a regression sweep; skip the first and it becomes a wishlist.

**Coherence** is what drifted: two pieces built at different times that never met, a rule the code stopped obeying, a description that outran its tools. Nothing is broken, no test fails, nobody files it.

**Reach** is what is missing: a capability the framework now offers and this agent never adopted, a step done by hand three weeks running, a request that came back a third time.

This is the agent's own surface: everything under `agent/`, plus `evals/`. The repository's documentation belongs to `repo-health-sweep`; when a finding could belong to either, leave it to that sweep rather than reporting it twice.

## The two bars

A **finding** contradicts something written down or something declared. Name the prose or the declaration it contradicts, or drop it.

A **proposal** is a capability worth having that nothing yet argues for. It needs an observation, not a contradiction: the friction hit, the tool that shipped, the request that repeated. Name what you observed and when, or drop it.

Neither bar is met by taste.

## Part one: coherence

**Wiring gaps.** Something is produced and nothing consumes it. For each channel, connection, extension and tool under `agent/`, ask what it puts into a session or hands the model, then search for the consumer. The inverse counts too: a module in `agent/lib/` imported by nothing but its own test.

**Rules the code stopped obeying.** `docs/capability-placement.md` holds them: logic outside `agent/lib/`, a lib module with no colocated test, a trust check that did not come from `agent/lib/trust.ts`, a section in `agent/instructions.md` that starts with "on GitHub" and belongs in a fragment.

**Prose that outran the tools.** Read the strings the model actually sees against the tools it actually has. Every tool named in `agent/instructions.md`, in a fragment under `agent/instructions/`, or in a `SKILL.md` must exist and be reachable from the session that reads it. The Linear connection's `tools.allow` list must cover what its description promises. A write tool the GitHub extension gained since `agent/lib/github/approval.ts` was written has no policy and silently defaults to an approval card.

**Behavior with no eval, and evals with no behavior.** A rule the instructions state that no eval exercises is a gap worth naming, most of all where a regression would be invisible: the reply-is-the-comment rule, the trust gate, the unattended turn's refusals. The reverse counts too: an eval asserting on a behavior the instructions no longer describe.

## Part two: reach

**What the framework gained.** `node_modules/eve/docs/` is the installed version's own documentation: a channel hook, an approval shape, a sandbox capability this agent could use and does not. `eve registry list` and `eve registry search` are the same question for integrations. A hand-written tool that duplicates a registry item is both a proposal and a finding.

**Surface already paid for and unused.** A tool in the Linear allow list that no instruction or skill ever tells the agent to call. A capability the GitHub preset carries that nothing reaches for. Either the workflow is missing or the entry is, and both are worth saying out loud.

**The manual step.** Anything the maintainer did by hand more than twice that a schedule, a skill, or a tool would carry.

## Delivering

- **Mechanical fixes** go in one draft pull request through `shipping-a-change`, with the checks run.
- **Findings and proposals** go in the Slack reply, in two short lists, each item one line and each naming what it contradicts or what was observed.
- **Nothing to report** is a valid outcome. Say what you checked, in one line.
- Do not open a pull request that changes this agent's behavior on judgement alone. A behavior change is a proposal, and the maintainer decides.
