# Remediation: a proposal

Status: proposal. Nothing here is built, and `docs/capability-placement.md` still says there are no schedules and no subagents. Merging this file does not change that. Building it does, and the pull request that builds it updates both files.

## What it would do

Baymi finds a vulnerable dependency and opens a draft pull request that moves it to the fixed version, with the result of the project's own checks attached. That is the first phase and the only one this proposal covers. Code fixes for review findings come later, if the first phase earns them.

GitHub's Dependabot already opens version bumps. The two things Baymi adds are the answer to "does our code reach the vulnerable function", which the review already works out from the checkout, and a fix when the bump breaks the build.

## Why it cannot run inside the review

The review agent is read-only for a reason recorded in `ARCHITECTURE.md`. Its sandbox holds a checkout of a pull request a stranger may have written, and eve attaches the installation token to that sandbox's requests to `github.com`. A shell there could run the stranger's code inside that boundary.

Remediation needs a shell: it installs packages, runs the type checker and runs the tests. So it has to live somewhere the token never reaches and a stranger's code never runs.

## The shape

eve gives a declared subagent its own tools, connections and sandbox, and it inherits none of the root's (`node_modules/eve/docs/subagents/index.mdx`). That is the boundary this design rests on:

- **`agent/subagents/remediation/`** gets `bash`, `read_file` and `write_file` in its own sandbox. It gets no GitHub connection and no GitHub tools.
- **The sandbox network** is denied by default. It allows the package registry for the repository's ecosystem and nothing else.
- **The input** is a structured task: the repository, the default branch's head sha, the package, the vulnerable version, the fixed version and the advisory ids. The caller builds it from GitHub's data, not from text the model read.
- **The output** is a unified diff and a verification report, returned through `outputSchema`. The subagent never pushes.
- **The caller** is ordinary channel code. It checks the repository out at the sha it named, applies the diff, pushes a `baymi/` branch with the installation token and opens a draft pull request. The token stays outside the sandbox that ran code.

The subagent runs only on code the maintainer already trusts: the default branch of an installed repository, at a sha the caller chose. It never runs on a pull request head.

## What starts it

Phase 1 runs only when a person asks for it. The maintainer mentions `@baymiai fix <package>` on an issue or pull request, or asks in Slack. Both of those are attended turns, and the trust check in `agent/lib/trust.ts` already gates them.

A daily schedule over Dependabot alerts would come after phase 1 has worked by hand. It needs the App's "Dependabot alerts: read" permission and an eve schedule, so it also changes the capability-placement decision.

## How a fix is verified

The checks are deterministic. The model reads their output but does not decide whether they passed:

1. Install with lifecycle scripts off (`--ignore-scripts`), so a malicious package version runs nothing at install time.
2. Run the repository's type check and tests.
3. Read the dependency changes again and confirm that no added version has an advisory against it.

The draft pull request says which checks ran and how they ended. A fix whose checks did not all run is labelled an unverified mitigation, never a fix. That rule comes from google/mantis, where a patch that was not verified is `VERIFICATION_INCOMPLETE` rather than secure.

## Model, cost and limits

- **Model:** `claude-opus-5@azure` called tools 3 of 3 through the proxy, and `gpt-6-astra` 4 of 4. `glm-5.3` called them 0 of 2, so it is out (`docs/notes.md`).
- **Credits:** AI Pass gives this account 10,000 credits a day. One short probe request at effort `max` cost 350 to 440 credits. On 2026-10-02 the account's usage rose by about 930 credits while Baymi reviewed three pull requests on the production model, but other clients share the account, so that is a ceiling rather than a measurement. Nobody has measured a remediation run, which reads, edits and reruns checks. Measure one before setting the daily cap that leaves room for reviews.
- **Sandbox:** Vercel Hobby ends a sandbox session after 45 minutes and counts its memory against 420 GB-hours a month. An install plus a test run may need two vCPUs where the review needs one. The subagent deletes its sandbox when it returns, as the review's already does.

## What the App would need

The App now has Contents read and Pull requests write. Pushing a branch needs Contents write, which also lets the token change any branch. The caller would push only to `baymi/` branches. A branch protection rule on the default branch is what actually stops a push there, so phase 1 should not ship without one.

## Open questions

1. Is Contents write acceptable for this App, or should remediation use a second GitHub App that holds only that permission?
2. Should phase 1 cover only npm and Bun projects, or every ecosystem the dependency graph reports?
3. When the bump breaks the tests, should the subagent try a code fix in the same run, or open the draft with the failure and stop?
