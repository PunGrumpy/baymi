# ARCHITECTURE.md

A map of how this agent is put together, for humans and AI agents working in the repo. Keep it current as the codebase evolves.

## Project identification

- **Name:** Baymi (`baymi`), GitHub maintainer agent, ported from the Kody eve template. On GitHub it answers as the `baymiai` App, since `baymi` was already registered
- **Maintainer:** PunGrumpy
- **License:** MIT
- **Last updated:** 2026-08-13

## Overview

A personal GitHub maintainer agent built on the [eve](https://eve.dev) agent framework, made for freelancers and solo maintainers: one person, one repo, one Slack workspace. Every Monday a scheduled session composes a digest of the configured repo's open issues and posts it to the configured Slack channel; the reader replies in the thread to act on it ("create Linear issues for #1 and #2 and assign them to me") and the agent follows through, confirming in the thread with links. Between digests Baymi keeps working the repo: it posts an orienting summary comment when a pull request opens, answers @mentions on GitHub issues and PRs in-thread, and handles the issues users delegate or mention it on in Linear (Agent Sessions, e.g. "send me a summary of this issue", delivered as a Slack DM). GitHub access goes through the mounted GitHub Tools extension; Linear is an MCP connection; per-user preferences live in Vercel Blob. The agent runs on Vercel, the same way locally (`eve dev`) and in production (`eve deploy`).

eve discovers every capability from the filesystem under `agent/`. There is no central registry or wiring file: a tool's name is its filename, a connection's name is its filename, and so on.

## Project structure

```text
agent/
  agent.ts                  # model configuration (defineAgent): compaction + session token limits
  instructions.md           # the always-on system prompt: identity, voice, how a task starts, grounding
  instructions/
    first-responder.ts      # dynamic fragment: injected only on unattended triage turns; read plus one reply, nothing else
    github.ts               # dynamic fragment: mentions on issues/PRs, the opened-PR summary comment
    linear.ts               # dynamic fragment: Agent Sessions
    slack.ts                # dynamic fragment: answering in Slack, the weekly digest, digest thread replies
  channels/
    github.ts               # eve GitHub channel via Vercel Connect; botName `baymiai` (the App slug), @mentions reply in-thread (gate in lib/github/comments.ts), onPullRequest posts a summary comment on opened PRs (bots skipped)
    linear.ts               # eve Linear channel via Vercel Connect; Agent Sessions, onAgentSession injects requester email; dev-only webhook-trust flag
    slack.ts                # eve Slack channel via Vercel Connect; @mentions, DMs, and follow-ups in subscribed threads
    eve.ts                  # inbound route auth; dev-only localDevUser shim (user principal)
  connections/
    linear.ts               # Linear MCP server (mcp.linear.app); app-scoped auth via Vercel Connect; tools.allow list: reads plus save_issue/save_comment, no deletes or structural writes
  schedules/
    weekly-digest.ts        # cron "0 9 * * 1" (UTC), handler form: one to(slack) send per DIGEST_REPOS entry, each its own thread; structure comes from the digest-format skill
  sandbox.ts                # sandbox backend (Vercel Sandbox)
  subagents/
    researcher/             # agent.ts + instructions.md; fresh-context web researcher (web tools only)
  extensions/
    github.ts               # @github-tools/eve-extension (maintainer preset); mounts as `github__<toolName>`; comments and labels skip approval, createIssue/closeIssue and everything else keep it
  tools/
    send_slack_dm.ts          # Slack DM by email lookup; dynamic, withheld from Slack sessions (lib/slack.ts) so a reply is never delivered twice
    get_user_preferences.ts   # Blob: load this user's saved preferences
    save_user_preferences.ts  # Blob: save standing preferences (principal-scoped)
    clear_user_preferences.ts # Blob: clear this user's preferences (approval-gated)
  lib/                      # the only place logic lives; every module has a colocated *.test.ts
    digest.ts               # DIGEST_REPOS parsing and the per-repo digest prompt
    anthropic.ts            # the Anthropic-protocol provider, pointed at ANTHROPIC_BASE_URL
    env.ts                  # @t3-oss/env-core schema: every environment variable, validated once at module load
    instructions.ts         # loadsOnChannel: which system-prompt fragment a session sees
    slack.ts                # exposesSlackDmTool: which sessions see the DM tool
    failure.ts              # the message a channel posts when a turn or session dies
    trust.ts                # authorization, expressed once: trusted author_associations, and the unattended-triage principal
    user-preferences.ts     # principal-scoped Blob key + reserved-prefix guard (shared helper)
    github/
      comments.ts           # bot name, mention pattern, ignore rules, and the dispatch decision for a comment
      issues.ts             # whether a new issue starts an unattended triage turn, and how a failed one is recognized
  skills/                   # load-on-demand procedures, routed by description frontmatter
    writing-quality/        # AI-tells, plain English, web-content specs
    digest-format/          # weekly digest structure: grouping, needs-attention/stale criteria, one-line summaries
    triaging-issues/        # triage playbook: dedupe, repo-native labels, ask-or-close, repro requests
    github-linear-bridging/ # bridged Linear issues: dedupe check, backlinks, team choice, two-way links
evals/                      # `eve eval`: scored checks against a live model, tagged fast / needs-connect
docs/
  capability-placement.md   # where a new capability belongs, the two-layer rule, the review checklist
```

## Core components

| Component | Lives in | eve primitive | Responsibility |
| --- | --- | --- | --- |
| GitHub surface | `agent/channels/github.ts` | Channel | Receives `@baymiai` mentions on issues/PRs and replies in-thread; a custom `onComment` hook delegates to `shouldDispatchComment` (`agent/lib/github/comments.ts`), which dispatches only for commenters whose `author_association` is OWNER, MEMBER, or COLLABORATOR; an `onPullRequest` hook dispatches on opened PRs (bot authors skipped, not association-gated) to post a summary comment with a changed-files table |
| Linear surface | `agent/channels/linear.ts` | Channel | Linear Agent Sessions: users delegate/mention the agent on an issue; the `onAgentSession` hook injects the requester's name and email as session context; elicitations render natively |
| Slack surface | `agent/channels/slack.ts` | Channel | @mentions and DMs, plus follow-up messages in a thread that already has an active session (`isSubscribed()`); bot-authored messages are dropped. Thread continuation needs `message.channels`/`channels:history` on the connector; without them mentions still work |
| Route auth | `agent/channels/eve.ts` | Channel | Inbound auth for the eve route; the `localDevUser` shim upgrades the dev principal to a user so user-scoped features work in the dev TUI |
| Weekly digest | `agent/schedules/weekly-digest.ts` | Schedule | Cron `0 9 * * 1` (Mondays 09:00 UTC), handler form: `to(slack, { channelId })` starts the session on the Slack channel, so the digest is the session's final message and thread replies resume it; structure comes from the `digest-format` skill |
| Agent runtime | `agent/agent.ts` + `instructions.md` + `instructions/` | Agent | The model loop and behavior; the root model id comes from `MODEL` and resolves through the provider in `agent/lib/anthropic.ts`, which speaks the Anthropic protocol against whatever `ANTHROPIC_BASE_URL` points at. `reasoning` and `modelContextWindowTokens` are set in `agent/agent.ts` alongside it, so a model swap is an environment change but a reasoning or context-window change is a code one. The root prompt is always on; the fragments under `agent/instructions/` resolve at `session.started` and load only on their own channel (and in full on the HTTP session surface) |
| GitHub access | `agent/extensions/github.ts` | Extension | `@github-tools/eve-extension` (`maintainer` preset) via Vercel Connect, mounted under the `github` namespace so tools are exposed as `github__<toolName>`: read and triage issues on the repo; issue-conversation writes run without approval, higher-impact writes keep the extension's approval default |
| Linear access | `agent/connections/linear.ts` | Connection (MCP) | Create issues, comment, and cross-reference Linear; app-scoped auth via Vercel Connect (`linearAuth`, defined in the same file) |
| Slack DM tool | `agent/tools/send_slack_dm.ts` | Tool (dynamic) | Sends a DM to a workspace member resolved by email (`users.lookupByEmail` → `conversations.open` → `chat.postMessage`), app-scoped via Connect; delivers summaries requested from other surfaces, mainly Linear sessions. Resolved at `session.started` and withheld from Slack sessions, the weekly digest included, so the agent cannot deliver the same message twice |
| User preferences | `agent/tools/{get,save,clear}_user_preferences.ts` + `agent/lib/user-preferences.ts` | Tools | Per-user standing preferences in Blob, keyed to the resolved principal (never model input) |
| Skills | `agent/skills/` | Skill | Load-on-demand procedures: `writing-quality` (prose rules, loaded before drafting for humans), `digest-format` (the weekly digest's structure and criteria), `triaging-issues` (the triage playbook), `github-linear-bridging` (bridged-issue conventions and cross-links) |
| Researcher subagent | `agent/subagents/researcher/` | Subagent | Fresh-context web research for facts the repo and tracker don't hold; uses framework `web_search`/`web_fetch`, returns cited findings + gaps |

Channels and the connections are I/O boundaries. Tools run in the app runtime (full `process.env`). Skills only add instructions to context; they are not an execution surface. The `researcher` subagent runs in its own isolated child session, fresh context with none of the root's skills, connections, or tools, so the root packs everything it needs into the call `message`.

## Data flow

1. **Weekly digest:** the schedule's handler starts one session per entry in `DIGEST_REPOS` on the Slack channel with `to(slack, { channelId: DIGEST_SLACK_CHANNEL })`. A send that carries no thread joins no continuation, so each repository lands in its own thread and an issue number in a reply is unambiguous. The agent fetches all open issues on that repository with the `github` tools and composes the digest following the `digest-format` skill (needs attention, recent activity, stale; every issue cited as #N); its final message is delivered into the channel as the digest post.
2. **Digest thread replies:** a reply in the digest thread reaches the Slack channel's subscribed-thread policy and resumes the session. The agent resolves the referenced issue numbers against GitHub, performs the request (e.g. creates Linear issues via the `linear` connection), and replies in the thread with links.
3. **Linear sessions:** a user delegates/mentions the agent on a Linear issue; the channel injects the issue context, and the `onAgentSession` hook adds the requester's name and email so "send me a summary" needs no follow-up question. The agent works the request, delivering anything asked for directly as a Slack DM via `send_slack_dm` (the requester's email resolves their Slack account); if it still lacks an address it asks in-session (Linear renders elicitations natively) and saves it with the preference tools.
4. **GitHub mentions:** `@baymiai` on an issue or PR starts a session on the github channel; the agent answers in-thread, cross-referencing Linear through the MCP connection when useful.
5. **PR opened:** the `pull_request` webhook hits the github channel's `onPullRequest` hook, which dispatches a session anchored to the PR (opened action only, bot authors skipped) with the summary task injected as context. The channel supplies the PR metadata and changed-file patches; the agent posts one comment: what the PR does, a changed-files table, and where to start reviewing.

## Data stores

- **GitHub** (external): the repository and issue tracker the agent digests and triages. All access goes through `@github-tools/eve-extension` with credentials brokered by Vercel Connect; no token in code.
- **Linear** (external): where actioned issues land and where Agent Sessions run. Access via Linear's MCP server with app-scoped Connect auth (scopes `read`, `write`, `issues:create`, `comments:create`).
- **Vercel Blob**: per-user preferences under the reserved `user-preferences/<hashed-principal>.md` prefix, reachable only through the principal-scoped preference tools. Authenticated by the project's OIDC token (no `BLOB_READ_WRITE_TOKEN`).
- **Vercel Sandbox** (`/workspace/skills/...`): holds the seeded skill files the model reads. Not a durable application data store.

There is no application database.

## External integrations

| Integration | Purpose | Method |
| --- | --- | --- |
| GitHub | Issue/PR mentions and PR-opened events in, in-thread replies and PR summary comments out; issue reads and triage | eve GitHub channel + `@github-tools/eve-extension` (`maintainer` preset), both via Vercel Connect (`GITHUB_CONNECTOR`) |
| Linear (channel + MCP) | Agent Sessions in; issue creation, comments, and cross-references out | eve Linear channel via Connect (with an `onAgentSession` hook adding the requester's email to context); MCP connection to `mcp.linear.app` with app-scoped auth (`LINEAR_CONNECTOR`) |
| Slack | @mentions and DMs in, replies in-thread out | eve Slack channel via Vercel Connect (`SLACK_CONNECTOR`), which supplies the bot token and verifies inbound webhooks |
| Vercel Blob | Per-user preference storage | `@vercel/blob`, OIDC-authenticated |
| Anthropic-compatible endpoint | Root model access | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`, wired in `agent/lib/anthropic.ts` and used by `agent/agent.ts` and the eval judge |
| Vercel AI Gateway | Subagent model access | `agent/subagents/researcher/agent.ts` sets a bare gateway model id, so the researcher resolves through the linked project's OIDC token rather than the endpoint above |
| Vercel Sandbox | Isolated runtime that holds seeded skill files | `agent/sandbox.ts` (`vercel()` backend) |

## Deployment & infrastructure

- **Platform:** Vercel. Deploy with `eve deploy` (wraps `vercel deploy --prod`); the raw `vercel deploy` cannot auto-detect the eve framework.
- **Connectors:** provisioned via `vercel connect create` + `attach`; the GitHub trigger must point at `/eve/v1/github`, the Linear trigger at `/eve/v1/linear`, and the Slack trigger at `/eve/v1/slack`.
- **Environment:** connector UIDs `GITHUB_CONNECTOR`, `LINEAR_CONNECTOR`, and `SLACK_CONNECTOR`; model access `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`, with `MODEL` for the agent and `EVAL_MODEL` for the eval judge; digest config `DIGEST_REPOS` (comma separated) and `DIGEST_SLACK_CHANNEL`. Blob and the researcher subagent's gateway model both authenticate via the project's OIDC token, so neither carries a key of its own. Every variable above is declared and parsed in one place, `agent/lib/env.ts` (`@t3-oss/env-core` over Zod): nothing has a silent fallback, so a missing or malformed value fails discovery with a single aggregated report instead of an opaque failure at request time.
- **Local development:** `bun run dev` runs the same runtime in a TUI; `vercel env pull` supplies a short-lived OIDC token. The webhook surfaces (GitHub, Linear, Slack) run against a deployment. Schedules never fire on cadence in dev; trigger the digest once with `POST /eve/v1/dev/schedules/weekly-digest`.

## Security considerations

- **Inbound route auth** (`agent/channels/eve.ts`): `[localDevUser, vercelOidc()]` rejects public browser traffic; channel traffic is authenticated by each connector. `localDevUser` defers the trust decision to the framework's `localDev()` and only upgrades the resolved dev principal to a user, so user-scoped features work from the dev TUI without affecting production.
- **Outbound auth:** GitHub and Linear credentials are brokered by Vercel Connect; Linear is app-scoped through `linearAuth` (tokens resolved per call, never exposed to the model). Slack DMs are app-scoped through the same Connect mechanism (`send_slack_dm`). Blob uses the project OIDC token. No credentials live in code, and `.env*` is gitignored.
- **Human-in-the-loop:** the irreversible `clear_user_preferences` tool is gated with `approval` from `eve/tools/approval`. The GitHub tool set ungates the reversible issue-conversation writes (comment, label, create/close issue) because the digest thread is the core reply-to-act loop and a pending approval would strand it; merges, pushes, and other higher-impact writes keep the extension's approval default. The connections accept the same `approval` field; neither passes a policy today (see Future considerations).
- **Per-user isolation:** the preference tools derive their Blob key from the resolved principal (`ctx.session.auth.current`), never from model input, so a session can only touch its own user's file; the id is hashed so the stored path carries no raw identifier. Preference files live under the reserved `user-preferences/` prefix. The Blob store is provisioned public, so preferences are scoped, not strongly confidential — use a private store if that matters.
- **Mention authorization:** the github channel's `onComment` hook keeps the built-in mention and ignore rules but dispatches only when the commenter's `author_association` is OWNER, MEMBER, or COLLABORATOR. On a public repo, arbitrary accounts can @mention the agent, and a dispatched session carries ungated GitHub writes, app-scoped Linear read/write, and Slack DM sending; the association gate keeps those tools drivable only by people the repo already trusts with write access. Untrusted mentions are acknowledged without a session.
- **Prompt-injection surface:** the agent reads issue bodies, comments, Slack messages, and PR titles, descriptions, and diffs written by third parties. The PR-opened hook means a session starts on third-party content with no human mention at all (deliberately: summarizing outside PRs is the feature); its injected task is scoped to posting a single summary comment, the instructions forbid it from reviewing or requesting anything, and the ungated GitHub writes are limited to reversible issue-conversation actions on the configured repo, which bounds what injected text can trigger without a human approval. Instruction-following on injected text remains model judgment, not mechanism; the association gate above closes the direct command channel, but content-borne injection is still worth keeping in mind when extending the PR hook or the connections.

## Development & testing

- **Runtime/TUI:** `bun run dev` (eve dev TUI; `/model` links a provider).
- **Type checking:** `bun run typecheck` (tsc).
- **Discovery diagnostics:** `bun x eve info` (must report 0 errors / 0 warnings), or `bun run validate` for typecheck + discovery together.
- There is no unit-test suite; verify behavior in the dev TUI.

## Future considerations

- Approval-gating outbound writes: Linear issue creation and Slack DMs are ungated today because they are the agent's core loop; add per-connection or per-tool `approval` policies if a human confirm step is wanted.
- Digest fan-out: `DIGEST_REPOS` takes any number of repositories, but they all post to one `DIGEST_SLACK_CHANNEL`, one thread each. Routing different repositories to different channels would mean a repo-to-channel map rather than a list. At a large number of repositories the channel gets noisy, and the alternative (one digest covering every repo) would need issues cited as `owner/repo#N` and a rewrite of the thread-reply rules.
- Digest memory: tracking which issues were already reported (e.g. in Blob) so "new this week" is computed against the last digest rather than issue timestamps alone.
- A deterministic style checker (e.g. a banned-words lint reading the `writing-quality` references) to complement model judgment on outgoing prose.

## Glossary

- **eve:** the agent framework powering this app; discovers capabilities from `agent/`.
- **Channel:** an inbound/outbound surface. Here: GitHub, Linear, Slack, plus the eve route's auth config.
- **Connection:** an external server (MCP/OpenAPI) exposed to the model; tools are called as `connection__<name>__<tool>`. Here: `linear`.
- **Tool:** a typed action authored with `defineTool` (or mounted from an SDK, like the `github` tools), run in the app runtime.
- **Schedule:** a cron-triggered session under `agent/schedules/`. Here: `weekly-digest`, a handler-form schedule that starts the digest session on the Slack channel.
- **Skill:** a load-on-demand Markdown procedure; the packaged form requires `description` frontmatter used for routing. Here: `writing-quality`, `digest-format`, `triaging-issues`, and `github-linear-bridging`.
- **Subagent:** a declared agent under `agent/subagents/<id>/` that the root delegates to as a tool. It runs in its own fresh child session and inherits none of the root's skills, connections, or tools, so the root passes context in the call `message`. Here: `researcher` (web research).
- **Vercel Connect:** brokers OAuth/credentials for GitHub and Linear; connectors are identified by a UID.
- **OIDC:** the project's Vercel identity token, used to authenticate Blob (and AI Gateway) without static keys.
