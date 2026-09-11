# Choosing where a capability lives in Baymi

Baymi is one agent for one person: their repositories, their Slack workspace. The root agent has every capability, and at this size that is right. What matters is how each one is expressed, so the files under `agent/` stay readable as they grow.

Use this order when adding a capability. Each step is cheaper than the one below it, so stop at the first that does the job.

1. **A skill** (`agent/skills/<id>/SKILL.md`) when the model already has the tools and only needs a procedure. No code, and it costs nothing until the model loads it. `security-review` is this.
2. **An instruction fragment** (`agent/instructions/<name>.ts`) when a rule applies on one channel or one kind of turn and has to be in context without being asked for. `review.ts` is this: it loads only on unattended turns.
3. **A tool** (`agent/tools/`) only when the operation needs Baymi-side logic: credential brokering, a gate, or shaping a response the model should not see raw. `list_installed_repositories` and `notify_maintainer` are that. Before adding one, count: the gateway degrades as the tool list grows (`docs/notes.md`).
4. **A memory slot** (`agent/memory/`) when something has to outlive a session. There is one, and it is the maintainer's; a second scope is a design decision, not a file.
5. **A channel hook** (`agent/channels/`) when the agent should act on an event nobody typed. `onPullRequest` is the only one, and it is deliberately narrow.

There are no schedules and no subagents. A schedule produces a report nobody asked for, and the direction is event-driven check-ins that say one thing. A subagent is justified only by an observed problem, such as a session losing the thread or spending too many input tokens because a side task shares its context. No such problem has been observed.

## The two-layer rule

Every code file under `agent/` outside `agent/lib/` is wiring. It declares a channel, tool, memory slot, or instruction fragment and imports its logic from `agent/lib/`. `agent/channels/github.ts` declares the channel and delegates the decisions to `agent/lib/github/pull-requests.ts` and `agent/lib/github/comments.ts`; the decisions are what a test can reach.

Logic lives in `agent/lib/`, in small single-purpose functions, each with a colocated `*.test.ts` that `bun run test` picks up. A module stays flat until its domain has a second file, then the domain gets a directory (`agent/lib/github/`, `agent/lib/slack/`).

Skills and instructions are authored prose, not code. They live where eve discovers them and have no `agent/lib/` counterpart.

Authorization is expressed once, in `agent/lib/trust.ts`. A new capability that needs to know whether a caller is trusted, or whether the turn is unattended, imports from there rather than inventing its own check.

## The read-only rule

The agent has no shell, writes no files, and fetches no URLs. That is a design decision recorded in ARCHITECTURE.md, not a gap. A capability that needs any of them (running a scanner, fetching an advisory) is a change to that decision, and it needs its own gate: at minimum, withheld on unattended turns, and never reachable from content a stranger wrote.

## Instructions

`agent/instructions.md` holds only what every session needs: identity, voice, the read-only posture, and the grounding rules. Anything that only applies on one channel is a fragment in `agent/instructions/<channel>.ts`, gated by `loadsOnChannel` from `agent/lib/instructions.ts`; anything that only applies on unattended turns is gated by `isUnattended`.

When a section you are about to add to the root file starts with "in Slack" or "when reviewing", it is a fragment. When a procedure is long, optional, or only needed for one kind of request, it is a skill instead: instructions are always in context, skills are not.

## Review checklist

Answer these in the pull request that adds a capability:

1. Skill, fragment, tool, memory, or hook, and why not the cheaper one above it?
2. Where does the logic live in `agent/lib/`, and where is its test?
3. Does it need a trust check, and does it come from `agent/lib/trust.ts`? What does it do on an unattended turn?
4. Does it add a tool to every prompt, and was the count re-measured?
5. Which skill, fragment, or doc describes it, updated in the same pull request?
