---
description: "Playbook for the weekly repository sweep: documentation checked against the code it describes, the conventions the repo wrote down checked against what it does, and issues that went quiet. Applies the mechanical fixes as a draft pull request and reports the rest. Load when the repo-health-sweep schedule fires, or when asked for a repo audit, a docs-versus-code check, or a convention drift review. Not for triaging one issue, reviewing a diff, or answering a question about the code."
---

# Repo health sweep

Documentation rots quietly. Nothing fails, no test goes red, and a reader follows a paragraph that stopped being true three commits ago. This sweep is the pass that finds those, over each repository in the digest list.

Reading is free and this session has no thread checkout, so read through `github__getRepositoryTree`, `github__getFileContent`, and `github__searchCode`. Reach for the sandbox only when a claim has to be _run_ to be settled.

## The bar

A finding **contradicts something written down**: a paragraph against the code it describes, a documented command against the script that exists, a rule the repo states against a file that breaks it. Name the prose and name the code, or it is not a finding.

"I would have written this differently" is not a finding. Neither is a suggestion the repo never promised. Taste is not drift.

## What to check

1. **Prose against code.** For the repository's own guides (`README.md`, `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, anything under `docs/`), take every concrete claim and check it: a file path that must exist, a command that must be in `package.json`, an environment variable that must be in the schema, a default that must match the code, a link that must resolve.
2. **The repo's own conventions.** Read the rules the repository states about itself and check the code against them, not against your preferences. In this repository that is `AGENTS.md` and `docs/capability-placement.md`: the two-layer rule (a file under `agent/` outside `agent/lib/` holding logic rather than wiring), a module in `agent/lib/` with no colocated `*.test.ts`, a trust check written inline instead of coming from `agent/lib/trust.ts`.
3. **Instructions and skills against the tools.** Every tool name mentioned in `agent/instructions.md`, an instruction fragment, or a `SKILL.md` has to exist and be reachable from the session that reads it. A skill pointing at a tool that was renamed fails silently, and only at the moment it matters.
4. **The environment.** Every variable in `agent/lib/env.ts` appears in `.env.example` with a usable description, and nothing in `.env.example` is gone from the schema.
5. **Issues that went quiet.** Open issues with no activity for a month, and issues answered but never closed. Report them; do not close anything on this run.

## Delivering

- **Mechanical fixes** (a stale path, a renamed script, a wrong default, a missing `.env.example` line) go in one draft pull request through `shipping-a-change`, with the repo's checks run. One pull request for the sweep, not one per typo.
- **Everything else** goes in the Slack reply: the finding, the file, and the prose it contradicts, one line each, grouped by the check that found it.
- **A clean sweep** is one line saying what you checked and that it held.
