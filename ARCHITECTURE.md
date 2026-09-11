# Architecture

## Project identification

- **Name:** Baymi (`baymi`), a security-minded companion for one person's repositories, built on eve. On GitHub it answers as the `baymiai` App, since `baymi` was already registered
- **Maintainer:** PunGrumpy
- **License:** MIT
- **Last updated:** 2026-09-11

## Overview

Baymi watches the repositories its GitHub App is installed on. When a pull request opens on one of them, it reads the diff and the checkout and posts one security review as a comment. When the maintainer mentions it on an issue or pull request, it answers there. In Slack it answers the maintainer about those repositories, remembers how the maintainer likes things done, and posts on its own, once and briefly, when a review finds something that should not wait.

It never changes a repository and never runs its code. Every write beyond its reply either runs because a trusted person asked or waits on an approval card.

eve discovers every capability from the filesystem under `agent/`. There is no central registry or wiring file: a tool's name is its filename, a memory slot's name is its filename, and so on.

## Project structure

```text
agent/
  agent.ts                  # model configuration (defineAgent): reasoning, compaction, session output cap
  instructions.md           # the always-on system prompt: identity, voice, read-only posture, grounding, writes and memory
  instructions/
    github.ts               # fragment for GitHub sessions: the reply is the comment, mentions, pull requests
    review.ts               # fragment injected on unattended review turns only: what the turn may do, what to write
    slack.ts                # fragment for Slack sessions: formatting, preferences, no checkout here
  channels/
    github.ts               # onPullRequest starts the unattended review; onComment gates mentions on trust; message.completed submits a parsed reply as a GitHub review; review failures go to Slack, not the PR
    slack.ts                # DMs, mentions, and follow-ups in threads it owns; humans of the workspace only
    eve.ts                  # inbound auth for the HTTP route (eve dev, evals, direct API calls)
  extensions/
    github.ts               # @github-tools/eve-extension; mounts the 11 tools from lib/github/tools.ts with inline approval policies
  memory/
    file.ts                 # eve's file memory on Vercel Blob; one shared "maintainer" scope, disabled on unattended turns
  tools/
    list_installed_repositories.ts  # the repositories the App is installed on, which is the agent's whole scope
    notify_maintainer.ts    # dynamic: the one-line Slack check-in, present only on unattended reviews when a target is configured
    read_file.ts, load_skill.ts, ask_question.ts  # the three defaults kept; agent.ts sets defaultTools: false
    glob.ts, grep.ts        # framework read tools, opted in
  hooks/
    evlog.ts                # one evlog wide event per turn; fs drain in dev, PostHog when configured; never message content
  sandbox.ts                # Vercel Sandbox; marks /workspace git-safe so the channel checkout succeeds; one snapshot per sandbox
  skills/
    security-review/        # the review procedure, severity scale, and format; references/checklist.md lists the patterns by kind of change
  lib/                      # the only place logic lives; every module has a colocated *.test.ts
    env.ts                  # @t3-oss/env-core schema: every environment variable, validated once at module load
    anthropic.ts            # the Anthropic-protocol provider, pointed at ANTHROPIC_BASE_URL
    trust.ts                # authorization, expressed once: trusted associations, the reviewer principal, Slack humans
    instructions.ts         # channelName and loadsOnChannel: which fragment a session sees
    failure.ts              # the notices a channel posts when a turn or session dies, and the log line that keeps the detail
    drains.ts               # fan-out for wide events: one failing destination never takes the turn with it
    github/
      comments.ts           # bot name, mention pattern, ignore rules, and the dispatch decision for a comment
      pull-requests.ts      # which pull request events start a review, how a review session is recognized, the PR a session is anchored to
      tools.ts              # the 11 GitHub tools this agent mounts, reads and writes listed apart
      review.ts             # the reply-to-review parser and renderer: finding blocks to inline comments, hidden markers, comment splitting
      approval.ts           # who answers for a write: refused when unattended, uncarded or carded otherwise
      credentials.ts        # Connect installation token plus the App's own webhook secret; token minting for the tool
      installation.ts       # GET /installation/repositories, paged and parsed
    slack/
      notify.ts             # the check-in card (Block Kit, Vercel's deployment-message shape) and the two-call Slack post (opens a DM when the target is a person)
evals/                      # `eve eval`: scored checks against a live model, all tagged fast
docs/
  capability-placement.md   # where a new capability belongs, the two-layer rule, the review checklist
  notes.md                  # runtime and tooling behaviour that cost time to discover
```

## Core components

| Component | Lives in | eve building block | Responsibility |
| --- | --- | --- | --- |
| Pull request review | `agent/channels/github.ts` + `agent/lib/github/pull-requests.ts` + `agent/lib/github/review.ts` + `agent/instructions/review.ts` + the `security-review` skill | Channel hook | `onPullRequest` dispatches on `opened` and `ready_for_review`, skipping drafts and bots (`shouldReviewPullRequest`). The session runs under the constructed reviewer principal `github:baymiai` (`agent/lib/trust.ts`), which every gate recognizes. GitHub writes are refused, memory is off, and the reply is the only output the turn may produce. eve puts the diff in context and checks the head commit out into the sandbox before the first model call. The skill holds the procedure and the format. The channel's `message.completed` handler parses the reply (`parseReview`) and submits it as one GitHub review with `event: COMMENT`: each finding becomes an inline comment on the line its `File:` line names, with a `<details>` block for the reasoning, an optional `suggestion` block, and a hidden `<!-- baymi:finding -->` marker; the rest becomes the review body. A reply that does not parse, or a review GitHub rejects, is posted as an ordinary comment. A review that fails posts nothing on the pull request and posts to Slack instead, so a missing review is not mistaken for a clean one |
| Mentions | `agent/channels/github.ts` + `agent/lib/github/comments.ts` + `agent/instructions/github.ts` | Channel hook | `@baymiai` from an owner, member, or collaborator starts an attended session on the issue or pull request; everyone else is acknowledged without one. A second look reads the earlier findings back through `listPullRequestReviewThreads`, answers each in its thread with `replyToReviewComment` (fixed, still open, withdrawn), and puts new findings in the reply so they get their own inline comments. The channel posts the turn's completed message as the reply. The comment tools exist for writing on some other thread |
| Slack companion | `agent/channels/slack.ts` + `agent/instructions/slack.ts` | Channel | DMs, mentions, and follow-ups in threads the agent owns, from humans of the workspace only (`isSlackHuman`, pinned to `SLACK_TEAM_ID` when set). There is no checkout here. The GitHub tools read pull requests, issues, and files, and the agent directs a request for a full review back to the pull request thread |
| Check-ins | `agent/tools/notify_maintainer.ts` + `agent/lib/slack/notify.ts` | Tool (dynamic) | One Block Kit card to `SLACK_NOTIFY_CHANNEL`, a channel or the maintainer's own DM, on a critical or high finding. The card takes the shape of Vercel's deployment messages: a status dot and a bold linked headline, the summary and a `sha | repository | via Baymi security review | time`line in a colored bar, and two link buttons, "View pull request" and "Files changed". A one-line`text` fallback rides along for notifications. Resolved per turn and present only on an unattended review when a target is configured. The tool reads the pull request it names from the auth the channel minted at dispatch (`pullRequestFromAuth`), never from the model, so a diff cannot redirect the check-in. The channel's failure handlers send the review-failed notice through the same delivery path |
| Memory | `agent/memory/file.ts` | Memory | eve's `fileMemory()` on Vercel Blob, one document under a constant `maintainer` scope. The same person is `github:<id>` on a pull request and `slack:<team>:<id>` in a DM, and a preference stated in one place holds in the other. The scope resolves to `null` on unattended turns, which disables recall and the save tools there, so a diff can never write into what every later turn reads |
| Scope | `agent/tools/list_installed_repositories.ts` + `agent/lib/github/installation.ts` | Tool | There is no configured repository list. GitHub delivers webhooks and mints tokens only for repositories the App is installed on, and this tool reads that set back so the agent can say what it watches and refuse what it does not |
| GitHub access | `agent/extensions/github.ts` + `agent/lib/github/tools.ts` + `agent/lib/github/approval.ts` | Extension | Eleven tools under the `github` namespace: seven reads and four writes. `addIssueComment`, `addPullRequestComment`, and `replyToReviewComment` run uncarded for a trusted person and are refused on an unattended turn; `createIssue` asks on a card. The review itself is not a tool: the channel submits it with a fixed `COMMENT` event, so nothing mounted can approve or request changes, edit a file, label, assign, or close |
| Agent runtime | `agent/agent.ts` + `instructions.md` + `instructions/` | Agent | The model comes from `MODEL` through `agent/lib/anthropic.ts`; reasoning stays high because a review is one long careful read. The root prompt is always on. Fragments resolve at `session.started` and load only on their own channel, and all of them load on the HTTP route, which exists to exercise the others |
| Telemetry | `agent/hooks/evlog.ts` + `agent/lib/drains.ts` | Hook | One `baymi_turn` event per turn: identity, channel, tokens, tools, outcome, never content. The model answers through a gateway of the operator's choosing, so this is the only record of what a week of reviews cost |

## Why it is read-only

The sandbox holds a checkout of whatever pull request last opened, and the pull request came from whoever opened it. eve attaches the installation token to the sandbox's outbound requests to `github.com` for the checkout. A shell that could run the pull request's code could make requests from inside that boundary. So `agent/agent.ts` sets `defaultTools: false`, which removes `bash` and `write_file`, and with them `web_fetch` and `web_search`, because a URL built from an untrusted diff could send a private repository's contents to an outside host in the query string. `agent/tools/` adds back `read_file`, `load_skill`, and `ask_question`, and opts into `glob` and `grep`, which search the filesystem. The review is reasoning over code, and the instructions say so. The agent never claims to have run, tested, or reproduced anything.

`todo` and the built-in `agent` delegation stay off for a smaller reason: the gateway this agent answers through degrades as the tool list grows (`docs/notes.md`), and a review is one pass with no side quests to track.

## Data flow

1. **A pull request opens** on an installed repository. GitHub posts `pull_request` at `/eve/v1/github`; `shouldReviewPullRequest` accepts `opened` and `ready_for_review` from a human, and the channel starts a session under the reviewer principal. eve injects the diff and checks the head commit out. The agent loads `security-review`, reads the diff and the surrounding code, and writes its reply in the skill's format. The channel submits that reply as a GitHub review: one inline comment per finding, on its line, and the summary as the review body. If a finding is critical or high it calls `notify_maintainer` once, and the maintainer gets one line in Slack with a link.
2. **The maintainer mentions `@baymiai`** on that pull request, or any issue. `shouldDispatchComment` admits owners, members, and collaborators; the session (the same one, on a reviewed pull request) continues under their principal, so memory and the uncarded writes are available and the review fragment is not. The channel posts the reply in the thread.
3. **The maintainer talks to Baymi in Slack.** A DM, a mention, or a reply in a thread it owns starts or resumes a session. It answers from the GitHub tools, remembers what it is told to keep, and points a request for a full review back at the pull request.
4. **A review dies.** The channel's failure handler recognizes an unattended review from the state (a pull request with no triggering comment), logs the detail, posts nothing on the pull request, and sends the review-failed line to Slack when a target is configured.

## Data stores

- **GitHub** (external): the repositories and pull requests. All access goes through the eve channel and `@github-tools/eve-extension` with an installation token brokered by Vercel Connect; no token in code.
- **Slack** (external): the maintainer's workspace. Inbound through the eve channel via Connect; the check-ins post with the same connector's app-scoped token.
- **Vercel Blob**: the memory document, under eve's file memory prefix, authenticated with the store's token or the project's OIDC. `eve integration setup file-memory` provisions it.
- **Vercel Sandbox**: the checkout the read tools search. Not a durable store.

There is no application database.

## External integrations

| Integration | Purpose | Method |
| --- | --- | --- |
| GitHub | Pull request events and mentions in, review comments and replies out; reads of pull requests, issues, and files | eve GitHub channel + `@github-tools/eve-extension`, both taking their installation token from Vercel Connect (`GITHUB_CONNECTOR`); webhooks bypass Connect and are verified with `GITHUB_WEBHOOK_SECRET` |
| Slack | DMs, mentions, and thread replies in; replies and check-ins out | eve Slack channel via Vercel Connect (`SLACK_CONNECTOR`); check-ins through `chat.postMessage` with the connector's app token |
| Anthropic-compatible endpoint | Model access | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`, wired in `agent/lib/anthropic.ts` |
| Vercel Blob | Memory | eve's `fileMemory()` |
| PostHog (optional) | Turn telemetry | `evlog/posthog` drain, `POSTHOG_API_KEY` |

## Deployment

The agent runs on Vercel, the same way locally (`eve dev`) and in production (`eve deploy`). The GitHub App's webhook URL and the Slack connector's trigger both point at the production deployment; a preview behind Deployment Protection cannot receive either (`docs/notes.md`). Which repositories the agent watches is decided by where the GitHub App is installed, and nowhere else.
