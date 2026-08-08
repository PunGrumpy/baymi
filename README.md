# github-maintainer

A GitHub maintainer agent built on the [eve](https://eve.dev) agent framework, ported from [`vercel-labs/kody-eve-template`](https://github.com/vercel-labs/kody-eve-template).

Every Monday it posts a digest of a repository's open issues to a Slack channel. Reply in the thread to act on it ("create Linear issues for #1 and #2 and assign them to me") and it follows through, confirming with links. Between digests it comments a summary on newly opened pull requests, answers @mentions on GitHub issues and PRs, handles issues delegated to it in Linear Agent Sessions, and answers questions in Slack.

For how it is put together, read [ARCHITECTURE.md](./ARCHITECTURE.md).

## Surfaces

| Surface | Route | How it is triggered |
| --- | --- | --- |
| GitHub | `/eve/v1/github` | `@kody` from an owner, member, or collaborator; a newly opened PR |
| Linear | `/eve/v1/linear` | An Agent Session: delegate an issue or mention the agent |
| Slack | `/eve/v1/slack` | DM, @mention, a follow-up in a thread it is already working in, or a reply in the weekly digest thread |
| HTTP | `/eve/v1/session` | Direct API, used by `eve dev` and for testing |

## Requirements

- [Bun](https://bun.sh)
- A Vercel account with the [Vercel CLI](https://vercel.com/docs/cli) authenticated (`vercel login`)
- An Anthropic API key, or a compatible gateway (`ANTHROPIC_BASE_URL`)

## Setup

### 1. Install and link

```bash
bun install
vercel link
vercel env pull
```

`vercel env pull` writes `.env.local` with the project's variables and a short-lived OIDC token, which is what authenticates Vercel Blob locally.

### 2. Fill in the environment

Copy `.env.example` to `.env` and set every variable. All of them are declared and validated in `agent/lib/env.ts`, and none has a fallback: a missing or malformed value fails discovery with a single report naming every problem, rather than surfacing later as an opaque failure.

### 3. Provision the connectors

Each channel takes its credentials from a [Vercel Connect](https://vercel.com/docs/connect) connector, so there are no app private keys, bot tokens, or webhook secrets in this repo. Create one connector per surface and point its trigger at that surface's eve route:

```bash
vercel connect create github --triggers
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/github --yes
```

Repeat for `linear` (`--trigger-path /eve/v1/linear`) and `slack` (`--trigger-path /eve/v1/slack`). The `detach` then `attach` pair is required because `create` provisions the trigger at Connect's default path, which eve does not serve. Put each connector's UID in the matching `GITHUB_CONNECTOR`, `LINEAR_CONNECTOR`, and `SLACK_CONNECTOR` variable.

The Slack connector needs more than the defaults:

- **Bot Scopes** `chat:write`, `im:write`, and `users:read.email`, for the `send_slack_dm` tool ("DM me a summary" from a Linear session).
- **Trigger Event Types** `message.channels` and **Bot Scope** `channels:history` (plus `message.groups`/`groups:history` for private channels), so replies in the digest thread and other subscribed threads reach the agent without a re-mention.

eve also ships guided flows (`bun x eve add channel/github`, `bun x eve add linear`, `bun x eve integration setup slack`) that do the same provisioning. They rewrite the channel file afterwards, which would discard the customizations in `agent/channels/`: the commenter trust gate and PR hook in `github.ts`, the requester context in `linear.ts`, and the subscription policy in `slack.ts`. Back those files up before running a guided flow, or use the manual sequence above.

### 4. Pick the digest channel

Create (or choose) the Slack channel the weekly digest posts to, invite the bot to it, and put its conversation ID (Channel details → the `C…` ID) in `DIGEST_SLACK_CHANNEL`.

### 5. Deploy, then install the apps

```bash
bun x eve deploy
```

Once deployed, open each connector in the Connect dashboard and install its app where it should run: the GitHub App on the repository's org or account, the Linear app in the workspace, and the Slack app in the workspace.

## Local development

```bash
bun run dev
```

This runs the same runtime in a terminal UI. The webhook surfaces (GitHub, Linear, Slack) need a deployment to receive events, so use the TUI to exercise the agent directly. Schedules do not fire on cadence in dev; trigger the digest once with:

```bash
curl -X POST http://localhost:2000/eve/v1/dev/schedules/weekly-digest
```

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | eve dev server and terminal UI |
| `bun run build` | Build the deployment bundle |
| `bun run start` | Run a built bundle |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run validate` | Typecheck and discovery diagnostics together |
| `bun run check` | Ultracite lint and format check |
| `bun run fix` | Ultracite autofix |
| `bun x eve info` | Discovery diagnostics; must report 0 errors and 0 warnings |

eve does not load `.env` during discovery, so pass it explicitly when running the CLI outside the dev TUI:

```bash
env $(grep -v '^#' .env | grep -v '^$' | xargs) bun x eve info
```
