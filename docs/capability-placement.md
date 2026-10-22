# Choosing where a capability lives in Baymi

Baymi is one agent for one person: their repositories, their Slack workspace. The root agent has every capability, and at this size that is right. What matters is how each one is expressed, so the files under `agent/` stay readable as they grow.

Use this order when adding a capability. Each step is cheaper than the one below it, so stop at the first that does the job.

1. **A skill** (`agent/skills/<id>/SKILL.md`) when the model already has the tools and only needs a procedure. No code, and it costs nothing until the model loads it. `security-review` and `engineering-lead` are this.
2. **An instruction fragment** (`agent/instructions/<name>.ts`) when a rule applies on one channel or one kind of turn and has to be in context without being asked for. `review.ts` is this: it loads only on review turns.
3. **A tool** (`agent/tools/`) only when the operation needs Baymi-side logic: credential brokering, a gate, or shaping a response the model should not see raw. `list_installed_repositories` and `notify_maintainer` are that. Before adding one, count: the gateway degrades as the tool list grows (`docs/notes.md`).
4. **A memory slot** (`agent/memory/`) when something has to outlive a session. There is one, and it is the maintainer's; a second scope is a design decision, not a file.
5. **A channel hook** (`agent/channels/`) when the agent should act on an event nobody typed. `onPullRequest` is the only one, and it is deliberately narrow.
6. **A schedule** (`agent/schedules/`) only for something the maintainer asked to receive on a clock. `digest.ts` is that: the standing orders ask for a digest every weekday morning.

There is one schedule and one subagent. The rule used to be that there are no schedules, because a schedule produces a report nobody asked for and the direction was event-driven check-ins that say one thing. It changes because the maintainer now asks for exactly that report, on exactly that clock (`CLAUDE.md`: a digest each weekday morning), and a check-in cannot be a count of what is healthy. So the test is who asked: a schedule that nobody requested stays out. A schedule is held to the same two-layer rule as everything else: the file wires the installation token and the Slack token to `runDigest` in `agent/lib/digest/`, and the reading, classifying, rendering and keying are tested functions. It is the handler form with no `to(...).send`, so it starts no model turn: the digest text is code, and a conversation that could park on a question (`ask_question` cannot be withheld from the app, `docs/notes.md`) never exists. Delivery is at-least-once and Hobby fires a cron once a day at most, up to an hour late, so a schedule's post must be its own record (`docs/notes.md`) and nothing in it may assume the minute. A subagent is justified by an observed problem, such as a session losing the thread or spending too many input tokens because a side task shares its context, or by a boundary the root agent must not cross. `agent/subagents/chase/` is the second kind: fixing a pull request's failing check needs a shell and file writes, and a declared subagent gets its own tools and sandbox while inheriting none of the root's (`docs/chase.md`).

## The two-layer rule

Every code file under `agent/` outside `agent/lib/` is wiring. It declares a channel, tool, memory slot, or instruction fragment and imports its logic from `agent/lib/`. `agent/channels/github.ts` declares the channel and delegates the decisions to `agent/lib/github/pull-requests.ts` and `agent/lib/github/comments.ts`; the decisions are what a test can reach.

Logic lives in `agent/lib/`, in small single-purpose functions, each with a colocated `*.test.ts` that `bun run test` picks up. A module stays flat until its domain has a second file, then the domain gets a directory (`agent/lib/github/`, `agent/lib/slack/`).

Skills and instructions are authored prose, not code. They live where eve discovers them and have no `agent/lib/` counterpart.

Authorization is expressed once, in `agent/lib/trust.ts`. A new capability that needs to know whether a caller is trusted, or whether the turn is unattended, imports from there rather than inventing its own check.

## The read-only rule

The root agent has no shell, writes no files, and fetches no URLs. That is a design decision recorded in ARCHITECTURE.md, not a gap. A capability that needs any of them (running a scanner, fetching an advisory) is a change to that decision, and it needs its own gate: at minimum, withheld on unattended turns, and never reachable from content a stranger wrote.

The chase subagent is how that decision was changed, and it is the pattern for the next one. The shell lives in a declared subagent whose sandbox holds no credential and reaches only the hosts it needs. The subagent is static with `tool: false`, and the only way in is a workflow tool (`chase_pull_request`) whose approval policy and first step decide, with `mayChase`, who may start it, on which pull request and head, and within what budget; its own first tool checks the class again. The tools that hold a token run in the app runtime, and they read the pull request and the head from durable state rather than from the model. The root itself stays read-only: the reviewer never reaches the tool, and nothing the root runs executes code.

## Instructions

`agent/instructions.md` holds only what every session needs: identity, voice, the read-only posture, and the grounding rules. Anything that only applies on one channel is a fragment in `agent/instructions/<channel>.ts`, gated by `loadsOnChannel` from `agent/lib/instructions.ts`; anything that only applies on review turns is gated by `isReviewer`, and anything that holds for every unattended turn (the review, and the app on its own clock) by `isUnattended`. A rule that applies on every turn but the review, like the engineering lead's orders in `agent/instructions/lead.ts`, is gated by `loadsLeadOrders` (the inverse of `isReviewer`) at `turn.started`, not `session.started`, because a mention from the maintainer continues the session a review opened. It is not the inverse of `isUnattended`: the app's scheduled digest is unattended too, and it is the turn that needs the orders most.

When a section you are about to add to the root file starts with "in Slack" or "when reviewing", it is a fragment. When a procedure is long, optional, or only needed for one kind of request, it is a skill instead: instructions are always in context, skills are not.

## Review checklist

Answer these in the pull request that adds a capability:

1. Skill, fragment, tool, memory, or hook, and why not the cheaper one above it?
2. Where does the logic live in `agent/lib/`, and where is its test?
3. Does it need a trust check, and does it come from `agent/lib/trust.ts`? What does it do on an unattended turn?
4. Does it add a tool to every prompt, and was the count re-measured?
5. Which skill, fragment, or doc describes it, updated in the same pull request?
6. If it runs on a clock: who asked for it, what makes a second delivery of the same fire a no-op, and does it assume the cron fires on the minute?
