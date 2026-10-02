# Remediation

Status: phase 1 is built (`agent/subagents/remediation/`, `agent/lib/remediation/`). It has not run against a real repository yet. This file started as a proposal, and the sections below describe what was built. Where the build departs from the proposal, the section says why.

## What it does

When a person asks, Baymi bumps one vulnerable dependency in one repository and opens a draft pull request with the result of the project's own checks attached. That is phase 1. Code fixes for review findings come later, if phase 1 earns them.

GitHub's Dependabot already opens version bumps. Baymi adds two things. It answers whether the code reaches the vulnerable function, which the review already works out from the checkout. It also fixes the code when the bump breaks the build.

## Why it cannot run inside the review

The review agent is read-only for a reason recorded in `ARCHITECTURE.md`. Its sandbox holds a checkout of a pull request a stranger may have written, and eve attaches the installation token to that sandbox's requests to `github.com`. A shell there could run the stranger's code inside that boundary.

Remediation needs a shell, because it installs packages, runs the type checker and runs the tests. So it lives somewhere the token never reaches and a stranger's code never runs.

## The shape

eve gives a declared subagent its own tools, connections and sandbox, and it inherits none of the root's (`node_modules/eve/docs/subagents/index.mdx`). That is the boundary this design rests on:

- **The subagent** has `bash`, `read_file`, `write_file`, `glob` and `grep` in its own sandbox, plus three tools of its own. It has no GitHub connection and no GitHub tools. eve compiles its default tools into a dynamic subagent whatever `defaultTools` says, so `web_fetch`, `web_search`, `todo`, `ask_question` and `load_skill` are each disabled by name under its `tools/`.
- **The sandbox** reaches `registry.npmjs.org` and `registry.yarnpkg.com` and nothing else. The allow-list is on the `vercel()` factory, because a replacement after a lost sandbox does not run `onSession` again.
- **`prepare_checkout`** runs in the app runtime with the installation token. It confirms the repository is installed and resolves the task from GitHub. Then it downloads the default branch's archive at the head commit and writes the bytes into the sandbox. The task goes into durable session state, which the sandbox cannot reach and the model cannot edit.
- **`run_checks`** runs the install and the project's checks with fixed commands and records the exit codes in the same state.
- **`submit_fix`** reads the task and the check record from state, the files from the sandbox, and pushes a `baymi/` branch through the Git Data API. It then opens the draft pull request and deletes the sandbox.

The proposal had channel code push a diff the subagent returned. That cannot work as written. A parent cannot read a child's sandbox, and a lockfile is too large to pass through the model's output. So the subagent's own tools push, from the app runtime. The token still never enters the sandbox, and the repository and the commit still come from state rather than from the model.

The subagent runs only on code the maintainer already trusts: the default branch of an installed repository, at the commit `prepare_checkout` resolved. It never runs on a pull request head.

## Where the task comes from

The model names a repository and a package. Everything else comes from GitHub (`agent/lib/remediation/task.ts`):

1. The repository's default branch and its head commit.
2. The dependency graph's SBOM, which lists every resolved package with a package URL. The versions of the named package come from there.
3. GitHub's global advisory database, asked once per version in use.
4. The fixed version: the highest first patched version across those advisories. When an advisory has no patch, there is no fixed version, and the subagent stops.

The proposal named Dependabot alerts. The SBOM and the global advisories need only Contents read, so phase 1 needs no new permission.

## What starts it

A person asks: a mention of `@baymiai` on an issue or pull request, or a message in Slack. The root agent hands the request to the `remediation` subagent. `mayRemediate` in `agent/lib/trust.ts` decides whether the subagent is offered on a turn at all. It admits a person and refuses the reviewer principal, any service caller, and a turn with no caller. An unattended review never sees the subagent, so a diff cannot start one.

A daily schedule over Dependabot alerts would come after phase 1 has worked by hand. It needs an eve schedule and the App's "Dependabot alerts: read" permission.

## How a fix is verified

The checks are deterministic. The model reads their output but does not decide whether they passed (`agent/lib/remediation/checks.ts`):

1. Install with lifecycle scripts off: `--ignore-scripts`, or `--mode=skip-build` for Yarn.
2. Run the project's `typecheck`, `check`, `lint` and `test` scripts, whichever exist. Each run has `CI=true` and a ten-minute `timeout`.
3. Record a digest of the change after the install and before the checks. At submit, a different digest means the code changed after the checks ran.

The draft pull request leads with the verdict. A fix is verified only when every check ran and passed on the exact change being pushed. Anything else is an unverified mitigation, with every reason listed and the end of each failing check's output. That rule comes from google/mantis, where a patch that was not verified is `VERIFICATION_INCOMPLETE` rather than secure.

The proposal also had a third check: read the dependency changes again after the bump. That is not built.

## Model, cost and limits

- **Model:** the subagent uses the root's model and effort through `modelSettings` in `agent/lib/anthropic.ts`. In the probe, `claude-opus-5@azure` called tools 3 of 3 and `gpt-6-astra` 4 of 4, and `glm-5.3` called them 0 of 2 (`docs/notes.md`).
- **Credits:** AI Pass gives this account 10,000 credits a day. Nobody has measured a remediation run yet. Measure one before relying on remediation on a day with many reviews.
- **Sandbox:** two vCPUs, where the review uses one. Vercel Hobby ends a sandbox session after 45 minutes. `submit_fix` deletes the sandbox once the pull request is open, and the one-day snapshot expiry covers a run that ends any other way.

## What the App needs

The App has Contents read and write. The review needs only read, and remediation pushes with write. Write also lets the token change any branch, so a branch protection rule on each default branch is what stops a push there. On 2026-10-02 each installed repository got a ruleset that requires a pull request, except `website`, which is private on GitHub Free, where rulesets are not available. `pushDraftPullRequest` refuses any branch outside `baymi/` before it calls GitHub.

## Decisions (2026-10-02)

The maintainer answered the three open questions:

1. **The `baymiai` App keeps the Contents write it already has.** No second App.
2. **Every ecosystem the dependency graph reports.** Detection and the version bump cover all of them. Verification is the limit: the subagent can run checks only for a toolchain its sandbox has. Each toolchain added to the sandbox image grows every snapshot, and Hobby allows 15 GB of snapshot storage for the life of the account. So the sandbox starts with Node and Bun. A fix in another ecosystem opens as an unverified mitigation that names the checks it could not run, until its toolchain is added.
3. **When the bump breaks the checks, the subagent tries a code fix in the same run.** It gets two attempts, so `run_checks` runs at most three times. If the last run fails, the draft opens with the bump, the last attempt and the failing output.
