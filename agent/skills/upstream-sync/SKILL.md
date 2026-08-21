---
description: "Procedure for the weekly upstream check: reading what moved in eve, Vercel Connect, the GitHub Tools extension and the rest of this agent's dependencies, deciding what is worth taking, and removing workarounds their release made unnecessary. Load when the upstream-sync schedule fires, or when asked whether a dependency has moved, what a new eve version brings, or whether a note in docs/notes.md is still true. Not for shipping an unrelated change or for updating a dependency someone already asked for by name."
---

# Upstream sync

This agent is a thin layer over frameworks that move faster than it does. The weekly run answers two questions: what shipped, and what of it is worth taking.

The deliverable is a draft pull request or a written finding. Nothing merges without a person.

## What to watch

`package.json` is the list, but four of them carry this agent's behavior and are worth reading properly rather than diffing:

- **`eve`** — the runtime, the channels, the sandbox, the schedules. Its release notes are where a workaround in `docs/notes.md` goes stale.
- **`@vercel/connect`** — credentials for GitHub, Slack, and Linear.
- **`@github-tools/eve-extension`** — the GitHub tool set. A new write tool needs a line in `agent/lib/github/approval.ts`, or it silently defaults to an approval card that an unattended turn cannot answer.
- **`ai` / `@ai-sdk/anthropic`** — the model protocol.

`ultracite`, `oxlint`, `oxfmt`, `vitest` and `typescript` matter too, but a version bump there is a mechanical change: take it, run the checks, and say so in one line.

## The order

1. **Read what is installed.** `node_modules/<package>/package.json` for the version actually resolved, and `node_modules/eve/docs/` for the version's own documentation. Never state a current version from memory.
2. **Read what shipped.** `node_modules/eve/CHANGELOG.md` when it is there, and the package's repository releases through the GitHub tools when it is not. Compare against the installed version, not against your recollection.
3. **Sort what you found.** A release matters here when it: fixes something `docs/notes.md` records as a workaround, adds a capability an instruction or a skill already wishes for, changes an API this agent calls, or deprecates one it depends on. Everything else is noise, and saying "eve 0.41 is out, no change needed here" is a complete result.
4. **Check the notes against it.** `docs/notes.md` is a list of things that were true when they were written. A note whose cause upstream has fixed is a finding on its own: the workaround comes out with the note.
5. **Carry the mechanical ones.** Load `shipping-a-change` and follow it: the bump, the repo's checks (`bun run test`, `bun run typecheck`, `bun x ultracite check`), a commit in the repo's convention, `git_push`, then `github__createPullRequest` as a **draft**. One dependency per pull request when they can fail independently, one pull request for a coordinated bump.
6. **Leave the rest as findings.** A change that needs a decision (a new capability, a behavior change, an approach the repo has an opinion about) goes in the Slack reply with what it would cost and what it would replace. Do not open a pull request nobody asked for and nobody can evaluate in one read.

## What not to do

- Do not bump a major version and call it mechanical. A major is a finding with a migration attached, even when the checks pass.
- Do not remove a workaround because the changelog claims a fix. Reproduce the original failure first, or say the removal is unverified.
- Do not update a dependency this agent does not use.
- Do not report a version you did not read out of a file or an API response.
