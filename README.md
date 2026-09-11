<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="./brand/banner.png">
    <img src="./brand/banner.gif" width="100%" alt="">
  </picture>
</p>

# Baymi

[![CI status](https://img.shields.io/github/actions/workflow/status/PunGrumpy/baymi/ci.yml?branch=main&style=flat&colorA=000000&colorB=000000)](https://github.com/PunGrumpy/baymi/actions/workflows/ci.yml) [![Built on eve](https://img.shields.io/badge/built%20on-eve-black?style=flat&colorA=000000&colorB=000000)](https://eve.dev) [![License](https://img.shields.io/github/license/PunGrumpy/baymi?style=flat&colorA=000000&colorB=000000)](./LICENSE)

Baymi reviews every pull request opened on the repositories its GitHub App is installed on, for security only. It reads the diff and the code around it, then submits one GitHub review. Each finding is an inline comment on the line that causes it, with the reasoning folded away and a suggestion you can commit in one click when the fix is small enough. The summary is the review body. When it finds nothing, the body says so in two sentences.

```text
src/routes/admin.ts:12                                          Unresolved

  High · any caller can change any user's role

  ▸ Why the code allows it, and what closes it

  ┌ Suggested change ──────────────────────────────── Commit suggestion ┐
  │ - router.post('/admin/users/:id/role', async (req, res) => {        │
  │ + router.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
  └─────────────────────────────────────────────────────────────────────┘
  Unverified suggestion. I do not run code, so read it before committing.

baymiai reviewed
  Security review: 1 finding (1 high).
  Checked and clean: the listUsers change only adds a column to the select.
```

Baymi never changes your code and never runs it. It has no shell, no file writes, and no outbound fetch. You decide what to do with what it finds.

## What it does

- **Reviews every pull request**: opened on an installed repository, for security only. Drafts wait until they are marked ready; bots are skipped. The head commit is checked out, so it reads the callers, the middleware, and the config around the change, not only the hunk. Findings land as inline review comments you can resolve one by one.
- **Answers an @mention**: from an owner, member, or collaborator on any issue or pull request. Ask about a finding, ask it to check one file, or ask for a second look after a fix, and it answers each earlier finding in its own thread: fixed, still open, or withdrawn.
- **Answers in Slack**: what it found on a pull request, what is open, which repositories it watches. Tell it how you want findings reported or what counts as noise, and it saves that to memory.
- **Posts to Slack on its own in two cases**: a critical or high finding, and a review that could not finish. One card each, with a button to the pull request, so a missing review is not mistaken for a clean one.

```text
🟠 acme/widgets #12 has a high finding
│ The new upload endpoint writes to a caller-chosen path.
│ 72eadbc | acme/widgets | via Baymi security review | Today at 10:35 AM
│ [ View pull request ]  [ Files changed ]
```

Where you install the GitHub App decides what Baymi watches. There is no repository list to configure.

## Surfaces

| Surface | Route | What triggers it |
| --- | --- | --- |
| GitHub | `/eve/v1/github` | A pull request opened or marked ready for review; `@baymiai` from an owner, member, or collaborator |
| Slack | `/eve/v1/slack` | A direct message, an @mention, or a follow-up in a thread it is already working in |
| HTTP | `/eve/v1/session` | The direct API, which `eve dev` and the evals use |

## Requirements

- [Bun](https://bun.sh)
- A Vercel account with the [Vercel CLI](https://vercel.com/docs/cli) authenticated (`vercel login`)
- An Anthropic API key, or a token for any Anthropic-compatible endpoint you set as `ANTHROPIC_BASE_URL`. A review is one long read over a large diff, so pick a model that reasons well and calls tools reliably

## Setup

### 1. Install and link

```bash
bun install
vercel link
vercel env pull
```

### 2. Fill in the environment

Copy `.env.example` to `.env` and set every value. `agent/lib/env.ts` declares and validates all of them. No required variable has a fallback, so a missing value fails discovery with one report that names every problem.

### 3. Provision the connectors

Both channels read their credentials from a [Vercel Connect](https://vercel.com/docs/connect) connector, so this repository holds no app private key or bot token. The one secret it holds is the GitHub webhook secret.

**GitHub**: create the connector, then point the App's own webhook at the deployment instead of at Connect's forwarder, which is metered per delivery:

```bash
vercel connect create github
```

In the GitHub App's settings, set the webhook URL to `https://your_deployment.vercel.app/eve/v1/github`, generate a secret into `GITHUB_WEBHOOK_SECRET`, and subscribe to `pull_request`, `issue_comment`, and `pull_request_review_comment`. Permissions: Contents read, Metadata read, Issues read and write, Pull requests read and write.

**Slack**: create the connector with triggers and register eve's route:

```bash
vercel connect create slack --triggers
vercel connect detach slack/your_connector_name --yes
vercel connect attach slack/your_connector_name --triggers --trigger-path /eve/v1/slack --yes
```

Bot scopes: `chat:write`, plus `im:write` if the check-in target is a member. For thread follow-ups without a mention, add `message.channels` under trigger event types and `channels:history` under bot scopes (`message.groups` and `groups:history` for private channels).

### 4. Provision memory

```bash
bun x eve integration setup file-memory
```

This creates a private Vercel Blob store for the memory document and connects it to the project. Under `eve dev`, memory is held in process and needs no setup.

### 5. Deploy, then install the apps

```bash
bun x eve deploy
```

Install the GitHub App on the repositories Baymi should watch, and the Slack app in your workspace. To receive check-ins, put a channel ID or your member ID in `SLACK_NOTIFY_CHANNEL`.

## Local development

```bash
bun run dev
```

The webhook surfaces need a deployment to receive events, so drive the agent through the terminal UI. Paste a diff and ask for a review; the same instructions and skill apply. eve does not load `.env` during discovery, so pass it explicitly when you run the CLI outside the dev UI:

```bash
env $(grep -v '^#' .env | grep -v '^$' | xargs) bun x eve info
```

`bun run validate` typechecks and runs discovery together. `bun run test` covers the logic under `agent/lib/`. `bun run eval` scores the agent against a live model and costs real money.

## Where the code lives

- [ARCHITECTURE.md →](./ARCHITECTURE.md) every capability under `agent/`, and why the agent is read-only
- [Capability placement →](./docs/capability-placement.md) where a new tool, skill, or memory belongs
- [Notes →](./docs/notes.md) runtime behaviour that cost time to discover
- [Brand assets →](./brand/README.md) the logo, the banner, and the generator behind it

Built on the [eve](https://eve.dev) agent framework. The structure follows [Evi in `evloghq/evlog`](https://github.com/evloghq/evlog/tree/main/apps/evi). The name comes from Baymax, the healthcare companion in Big Hero 6.

[MIT-licensed](./LICENSE)
