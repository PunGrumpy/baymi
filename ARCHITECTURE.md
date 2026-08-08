# ARCHITECTURE.md

A map of how this agent is put together, for humans and AI agents working in the repo. Keep it current as the codebase evolves.

## Project identification

- **Name:** Kody, GitHub maintainer agent (eve template)
- **Maintainer:** Vercel Labs
- **License:** MIT
- **Last updated:** 2026-07-23

## Overview

A personal GitHub maintainer agent built on the [eve](https://eve.dev) agent framework, made for freelancers and solo maintainers: one person, one repo, one Slack workspace. Every Monday a scheduled session composes a digest of the configured repo's open issues and posts it to the configured Slack channel; the reader replies in the thread to act on it ("create Linear issues for #1 and #2 and assign them to me") and the agent follows through, confirming in the thread with links. Between digests Kody keeps working the repo: it posts an orienting summary comment when a pull request opens, answers @mentions on GitHub issues and PRs in-thread, and handles the issues users delegate or mention it on in Linear (Agent Sessions, e.g. "send me a summary of this issue", delivered as a Slack DM). GitHub access goes through the mounted GitHub Tools extension; Linear is an MCP connection; per-user preferences live in Vercel Blob. The agent runs on Vercel, the same way locally (`eve dev`) and in production (`eve deploy`).

eve discovers every capability from the filesystem under `agent/`. There is no central registry or wiring file: a tool's name is its filename, a connection's name is its filename, and so on.

## Project structure

```text
agent/
  agent.ts                  # model configuration (defineAgent): compaction + session token limits
  instructions.ts           # defineInstructions: the always-on system prompt
  channels/
    github.ts               # eve GitHub channel via Vercel Connect; botName "Kody", @mentions reply in-thread (gated to owner/member/collaborator commenters), onPullRequest posts a summary comment on opened PRs (bots skipped)
    linear.ts               # eve Linear channel via Vercel Connect; Agent Sessions, onAgentSession injects requester email; dev-only webhook-trust flag
    slack.ts                # eve Slack channel via Vercel Connect; @mentions, DMs, and follow-ups in subscribed threads
    eve.ts                  # inbound route auth; dev-only localDevUser shim (user principal)
  connections/
    linear.ts               # Linear MCP server (mcp.linear.app); app-scoped auth via Vercel Connect
  schedules/
    weekly-digest.ts        # cron "0 9 * * 1" (UTC), handler form: to(slack) posts the digest into DIGEST_SLACK_CHANNEL; structure comes from the digest-format skill
  sandbox.ts                # sandbox backend (Vercel Sandbox)
  subagents/
    researcher/             # agent.ts + instructions.md; fresh-context web researcher (web tools only)
  extensions/
    github.ts               # @github-tools/eve-extension (maintainer preset); mounts as `github__<toolName>`
  tools/
    send_slack_dm.ts          # Slack DM by email lookup; delivers summaries requested from other surfaces
    get_user_preferences.ts   # Blob: load this user's saved preferences
    save_user_preferences.ts  # Blob: save standing preferences (principal-scoped)
    clear_user_preferences.ts # Blob: clear this user's preferences (approval-gated)
  lib/
    env.ts                  # @t3-oss/env-core schema: every environment variable, validated once at module load
    user-preferences.ts     # principal-scoped Blob key + reserved-prefix guard (shared helper)
  skills/                   # load-on-demand procedures, routed by description frontmatter
    writing-quality/        # AI-tells, plain English, web-content specs
    digest-format/          # weekly digest structure: grouping, needs-attention/stale criteria, one-line summaries
    triaging-issues/        # triage playbook: dedupe, repo-native labels, ask-or-close, repro requests
    github-linear-bridging/ # bridged Linear issues: dedupe check, backlinks, team choice, two-way links
```

## Core components

| Component | Lives in | eve primitive | Responsibility |
| --- | --- | --- | --- |
| GitHub surface | `agent/channels/github.ts` | Channel | Receives @Kody mentions on issues/PRs and replies in-thread; a custom `onComment` hook dispatches only for commenters whose `author_association` is OWNER, MEMBER, or COLLABORATOR; an `onPullRequest` hook dispatches on opened PRs (bot authors skipped, not association-gated) to post a summary comment with a changed-files table |
| Linear surface | `agent/channels/linear.ts` | Channel | Linear Agent Sessions: users delegate/mention the agent on an issue; the `onAgentSession` hook injects the requester's name and email as session context; elicitations render natively |
| Slack surface | `agent/channels/slack.ts` | Channel | @mentions and DMs, plus follow-up messages in a thread that already has an active session (`isSubscribed()`); bot-authored messages are dropped. Thread continuation needs `message.channels`/`channels:history` on the connector; without them mentions still work |
| Route auth | `agent/channels/eve.ts` | Channel | Inbound auth for the eve route; the `localDevUser` shim upgrades the dev principal to a user so user-scoped features work in the dev TUI |
| Weekly digest | `agent/schedules/weekly-digest.ts` | Schedule | Cron `0 9 * * 1` (Mondays 09:00 UTC), handler form: `to(slack, { channelId })` starts the session on the Slack channel, so the digest is the session's final message and thread replies resume it; structure comes from the `digest-format` skill |
| Agent runtime | `agent/agent.ts` + `instructions.ts` | Agent | The model loop and behavior; the Anthropic provider points at `ANTHROPIC_BASE_URL` |
| GitHub access | `agent/extensions/github.ts` | Extension | `@github-tools/eve-extension` (`maintainer` preset) via Vercel Connect, mounted under the `github` namespace so tools are exposed as `github__<toolName>`: read and triage issues on the repo; issue-conversation writes run without approval, higher-impact writes keep the extension's approval default |
| Linear access | `agent/connections/linear.ts` | Connection (MCP) | Create issues, comment, and cross-reference Linear; app-scoped auth via Vercel Connect (`linearAuth`, defined in the same file) |
| Slack DM tool | `agent/tools/send_slack_dm.ts` | Tool | Sends a DM to a workspace member resolved by email (`users.lookupByEmail` → `conversations.open` → `chat.postMessage`), app-scoped via Connect; delivers summaries requested from other surfaces, mainly Linear sessions |
| User preferences | `agent/tools/{get,save,clear}_user_preferences.ts` + `agent/lib/user-preferences.ts` | Tools | Per-user standing preferences in Blob, keyed to the resolved principal (never model input) |
| Skills | `agent/skills/` | Skill | Load-on-demand procedures: `writing-quality` (prose rules, loaded before drafting for humans), `digest-format` (the weekly digest's structure and criteria), `triaging-issues` (the triage playbook), `github-linear-bridging` (bridged-issue conventions and cross-links) |
| Researcher subagent | `agent/subagents/researcher/` | Subagent | Fresh-context web research for facts the repo and tracker don't hold; uses framework `web_search`/`web_fetch`, returns cited findings + gaps |

Channels and the connections are I/O boundaries. Tools run in the app runtime (full `process.env`). Skills only add instructions to context; they are not an execution surface. The `researcher` subagent runs in its own isolated child session, fresh context with none of the root's skills, connections, or tools, so the root packs everything it needs into the call `message`.

## Data flow

1. **Weekly digest:** the schedule's handler starts a session on the Slack channel with `to(slack, { channelId: DIGEST_SLACK_CHANNEL })`. The agent fetches all open issues on `DIGEST_REPO` with the `github` tools and composes the digest following the `digest-format` skill (needs attention, recent activity, stale; every issue cited as #N); its final message is delivered into the channel as the digest post.
2. **Digest thread replies:** a reply in the digest thread reaches the Slack channel's subscribed-thread policy and resumes the session. The agent resolves the referenced issue numbers against GitHub, performs the request (e.g. creates Linear issues via the `linear` connection), and replies in the thread with links.
3. **Linear sessions:** a user delegates/mentions the agent on a Linear issue; the channel injects the issue context, and the `onAgentSession` hook adds the requester's name and email so "send me a summary" needs no follow-up question. The agent works the request, delivering anything asked for directly as a Slack DM via `send_slack_dm` (the requester's email resolves their Slack account); if it still lacks an address it asks in-session (Linear renders elicitations natively) and saves it with the preference tools.
4. **GitHub mentions:** @Kody on an issue or PR starts a session on the github channel; the agent answers in-thread, cross-referencing Linear through the MCP connection when useful.
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
| Vercel AI Gateway | Model access | Gateway model ids resolved through the linked project; the root model is set in `agent/agent.ts` and the subagent sets its own in `agent/subagents/researcher/agent.ts` |
| Vercel Sandbox | Isolated runtime that holds seeded skill files | `agent/sandbox.ts` (`vercel()` backend) |

## Deployment & infrastructure

- **Platform:** Vercel. Deploy with `eve deploy` (wraps `vercel deploy --prod`); the raw `vercel deploy` cannot auto-detect the eve framework.
- **Connectors:** provisioned via `vercel connect create` + `attach`; the GitHub trigger must point at `/eve/v1/github`, the Linear trigger at `/eve/v1/linear`, and the Slack trigger at `/eve/v1/slack`.
- **Environment:** connector UIDs `GITHUB_CONNECTOR`, `LINEAR_CONNECTOR`, and `SLACK_CONNECTOR`; model access `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`; digest config `DIGEST_REPO` and `DIGEST_SLACK_CHANNEL`. Blob authenticates via the project's OIDC token. Every variable above is declared and parsed in one place, `agent/lib/env.ts` (`@t3-oss/env-core` over Zod): nothing has a silent fallback, so a missing or malformed value fails discovery with a single aggregated report instead of an opaque failure at request time.
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
- Multi-repo digests: `DIGEST_REPO`/`DIGEST_SLACK_CHANNEL` are single values; supporting several repo/channel pairs would mean one schedule per pair or a config list.
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
