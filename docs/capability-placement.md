# Choosing where a capability lives in Baymi

Baymi is one agent for one person: one repository, one Slack workspace, one Linear workspace. The root agent carries every capability, and at this size that is right. The discipline is in _how_ each one is expressed, so the surface under `agent/` stays readable as it grows.

Use this order when adding a capability. Each step is cheaper than the one below it, so stop at the first that does the job.

1. **A skill** (`agent/skills/<id>/SKILL.md`) when the model already has the tools and only needs a procedure. No code, and it costs nothing until the model loads it. `digest-format`, `triaging-issues`, `github-linear-bridging` and `writing-quality` are all this.
2. **A schedule** (`agent/schedules/`) when work has to start on a cadence. The schedule sends a prompt into a channel and nothing more; the procedure it triggers belongs in a skill the agent loads, not in the schedule file. `weekly-digest.ts` carries only what the skill cannot know: which repo, and the rule to fetch fresh.
3. **A connection** (`agent/connections/`) when the capability is a remote API the model should call directly. Prefer it, with an explicit allow list, over hand-written fetch tools. Linear is a connection; GitHub arrives through the mounted GitHub Tools extension.
4. **A tool** (`agent/tools/`) only when the operation needs Baymi-side logic that a connection cannot express: credential brokering, gating, or shaping a response the model should not see raw. The four preference and Slack DM tools are that.
5. **A subagent** (`agent/subagents/`) only at the trigger below.

## The two-layer rule

Every code file under `agent/` outside `agent/lib/` is wiring. It declares a channel, tool, schedule, connection, or instruction fragment and imports its logic from `agent/lib/`. `agent/channels/github.ts` declares the channel and delegates the decision to `agent/lib/github/comments.ts`; the decision is what a test can reach.

Logic lives in `agent/lib/`, in small single-purpose functions, each with a colocated `*.test.ts` that `bun run test` picks up. A module stays flat until its domain has a second file, then the domain gets a directory (`agent/lib/github/` was the first).

Skills and instructions are authored prose, not code. They live where eve discovers them and have no `agent/lib/` counterpart.

Authorization is expressed once, in `agent/lib/trust.ts`. A new capability that needs to know whether a caller is trusted imports from there rather than inventing its own check.

## Instructions

`agent/instructions.md` holds only what every session needs: identity, voice, how a task starts, and the grounding rules. Anything that only applies on one surface is a fragment in `agent/instructions/<channel>.ts`, gated by `loadsOnChannel` from `agent/lib/instructions.ts` and resolved at `session.started`.

When a section you are about to add to the root file starts with "in Slack" or "when someone mentions you on GitHub", it is a fragment. When a procedure is long, optional, or only needed for one kind of request, it is a skill instead: instructions are always in context, skills are not.

Fragments load in full on the HTTP session surface (`eve dev`, the eval runner, direct API calls), because that surface exists to exercise behavior that belongs to another channel.

## When a subagent becomes justified

The trigger is observed, not aesthetic: an interactive session losing the thread or blowing up in input tokens because a side quest shares its context. `researcher` exists because open-web research is exactly that: many pages read to produce one fact, none of which the main session needs to keep.

A second trigger is an authority boundary, a capability whose credentials or failure modes should not move with the agent. None exists today.

## Review checklist

Answer these in the pull request that adds a capability:

1. Skill, schedule, connection, tool, or subagent, and why not the cheaper one above it?
2. Where does the logic live in `agent/lib/`, and where is its test?
3. Does it need a trust check, and does it come from `agent/lib/trust.ts`?
4. Which skill, instruction fragment, or doc describes it, updated in the same pull request?
