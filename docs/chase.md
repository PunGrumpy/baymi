# Chase

Status: built, and bound to the pull request it is handed since C1b (`agent/subagents/chase/`, `agent/lib/chase/`, `agent/tools/chase_pull_request.ts`). Run live on a scratch pull request at the maintainer's request, with a local Docker sandbox: it reproduced a failing test, fixed it, passed the checks and pushed one commit, and the pull request's CI went from red to green (`docs/notes.md` has the run, its cost and the two bugs it found first). The C1b bounds ran live on a second scratch pull request (below the fix loop's description, in `docs/notes.md`). The CI turn's hand-off has unit tests but has not run live. It replaces the remediation subagent, which eve 0.62.0 never offered.

## What it does

When a pull request's own code fails its checks, the chase takes it to green. It reproduces the failing check with the project's own scripts in a sandbox of its own, makes the smallest change that makes it pass, runs every check again, and pushes the fix as atomic commits to the pull request's branch. When it may not push there, it opens a pull request against that branch instead.

Two callers start one:

- **The CI turn.** A red check on the maintainer's pull request starts an app turn (`agent/lib/github/ci/`). When the classifier says the diff's own code failed (`own-code`), the turn's brief tells the model to call `chase_pull_request` once. Every other kind (a flake, a stale base, an external check) is handled as before and never reaches the chase.
- **The maintainer.** On a GitHub pull request, PunGrumpy can mention Baymi and ask it to chase that pull request by hand. The request must come from the pull request it is about: a Slack message, or a comment on an issue, names a pull request only in words, with no signed anchor behind it, so it cannot start a chase (see "What is bounded", below).

Nobody else can: not a collaborator, not the reviewer, not a stranger, and not `local-dev`, which is the maintainer for everything else but must not push to a real repository from a local eval (`mayChase` in `agent/lib/trust.ts`).

Dependency bumps are not the chase's job. Dependabot security updates open them upstream, and a Dependabot pull request whose checks go red is a pull request the chase takes to green like any other.

## Why it cannot run inside the review

The review agent is read-only for a reason recorded in `ARCHITECTURE.md`. Its sandbox holds a checkout of a pull request a stranger may have written, and eve attaches the installation token to that sandbox's requests to `github.com`. The chase needs a shell, because it installs packages and runs the type checker and the tests, so it lives where the token never reaches.

## The shape

- **`chase_pull_request`** (`agent/tools/`) is the only way in. It is a static workflow tool: eve 0.62.0 refuses a provider object and `defaultTools: false` from a dynamic subagent, so the subagent is static with `tool: false`, and only a workflow tool can call a hidden subagent by name. Its approval policy refuses every class but the app and the maintainer before it runs. Its first step, in the app runtime, admits the request (`agent/lib/chase/gate.ts`) and claims the budget. Then it calls the subagent with `ctx.agent("chase", ...)` and waits for its structured result. eve also refuses a tool and a subagent with the same public name, `tool: false` or not, which is why the tool's name is longer.
- **The subagent** (`agent/subagents/chase/`) runs on Claude Sonnet 5.5, called on Anthropic directly with `ANTHROPIC_API_KEY`, at effort `high`. It has `bash`, `read_file`, `write_file`, `glob` and `grep` in its own sandbox, plus four tools of its own. It has no GitHub connection and no GitHub tools.
- **The sandbox** has two vCPUs and reaches `registry.npmjs.org` and `registry.yarnpkg.com`, nothing else. GitHub is not on the list: the runtime downloads the head and pushes the fix itself.
- **`prepare_checkout`** takes the repository, the pull request and the head as the model's own arguments, so it first holds them to the session's auth (`agent/lib/chase/bind.ts`): the app to its CI turn's pull request, repository and head, and a person to the pull request their turn is about. Any other value ends the chase with a `refused` result. The child session runs under the parent's auth, which the signed webhook stamped and the model cannot edit, so this is the same anchor the gate checked. It then reads the pull request with the installation token, refuses anything but the open pull request at that head, downloads the commit's archive (200 MiB at most) and writes the bytes into the sandbox. The pull request, its head, its branch and the tree id of the clean checkout (A) go into durable session state, which the sandbox cannot reach and the model cannot edit. The sandbox clock starts here.
- **`run_checks`** installs with lifecycle scripts off and the lockfile frozen (`--frozen-lockfile`, `npm ci`, Yarn `--immutable`), then runs the project's `typecheck`, `check`, `lint` and `test` scripts, whichever exist, with fixed commands, and records the exit codes and two tree ids in state. The first run is the reproduction. A stale lockfile fails the install; it is never rewritten into a change.
- **`push_fix`** takes the commits the model proposes (a message and the files for each), holds the checkout to the session's auth once more, refuses anything the checks did not pass on, anything that is not a regular file and anything under `.github/workflows/`, and pushes from the app runtime through the Git Data API.
- **`stop_chase`** ends a chase that will not push and reports why, with the end of the failing output.

## The fix loop

Condensed from the bug-fix playbook, and enforced by the tools rather than only asked for:

1. **Reproduce first.** `run_checks` runs once before any edit. If every check passes, the failure did not reproduce here, and the chase stops (`not-reproduced`). A fix is only ever verified against a failure that run saw.
2. **Smallest change.** The instructions ask for the change the failure needs and nothing else, and forbid deleting, skipping or weakening a test.
3. **Run the full set.** Every attempt runs every check, not only the one that failed.
4. **Two attempts.** `run_checks` runs at most three times: the reproduction and two attempts. If the second attempt still fails, the chase stops and reports the captured output.

A fix is verified (`fixVerdict` in `agent/lib/chase/checks.ts`) only when:

- the reproduction failed, on a tree that was still the clean checkout;
- a later run passed every check;
- no run's install or checks changed a file, which three git tree ids decide: **A**, the baseline commit's tree after the clean checkout; **B**, the tree just before a run (A plus the model's own edits); **C**, the tree after the install and the checks. If C differs from B on any tracked or non-ignored path, `run_checks` ends the chase at once with a result that names the paths ("rewrote 2 files (bun.lock, src/format.ts)") rather than asking the model to choose. What is pushed is the index minus A, so only the model's own edits can go;
- the baseline commit has not moved (code in the sandbox ran `git commit` or `git reset`), and the tree has not moved since the last run, which the tree id taken again at push decides.

`push_fix` refuses anything else; there is no unverified push. A project whose checks write tracked files, or files its `.gitignore` does not cover (a formatter with `--write`, a snapshot update, a build into an unignored folder), therefore stops the chase on its first run. That is a cost of the rule, and it is fail-closed on purpose. It also ends a chase whose model edits a file in the same step as `run_checks` (eve runs a step's tool calls in parallel, so the edit lands while the checks run); the instructions tell the model to call `run_checks` alone.

## Where the fix goes

`planPush` in `agent/lib/chase/branch.ts`, decided from GitHub at the moment of the push, after reading the pull request again:

- **The head moved** while the chase worked: someone pushed newer work. Nothing is pushed (`superseded`).
- **Same repository, writable, unprotected, not the default branch:** the commits are chained on the head and the branch is fast-forwarded to the last one with `force: false`. GitHub refuses that unless the new commit descends from the branch's head, so nothing is ever rewritten.
- **A protected head branch, or the default branch,** or a fast-forward GitHub refused: a `baymi/chase/<pr>-<short sha>` branch is created at the fix, and a pull request is opened from it against the head branch.
- **A fork:** nothing. The fork is a repository the App is not installed on, so it can neither push there nor open a pull request into it. The gate refuses a fork before any sandbox runs.
- **No write access:** the gate creates one blob of a fixed few bytes just before it claims the budget (`probeWriteAccess` in `agent/lib/chase/commit.ts`). 201 means Contents write; 401, 403 and 404 end the chase before any model call or sandbox minute with the status `no-write-access`, and any other answer is refused as unconfirmed. Nothing points at the blob and GitHub drops it, so the probe leaves nothing behind. The repository's `permissions` field cannot do this job: for an installation token it reads all false. A 403 on the fast-forward itself is still reported as a failure.

Commits are Conventional Commits: `type(scope): imperative summary`, a blank line, and a body saying what failed and what changed. `push_fix` refuses a message without that shape, and one with a co-author trailer or a generated-by line (`agent/lib/chase/message.ts`). Every changed file goes in exactly one commit. The App is the author.

## What is bounded, and what is not

**Bounded by code, with a test each:**

- **The pull request.** A chase acts only on the pull request the session was handed. The gate and `prepare_checkout` both hold the repository, the number and, for the app, the head to the session's auth; `push_fix` checks again. Any mismatch ends the chase as `refused`. A turn with no pull request behind it admits none (`bind.ts`).
- **Fast-forward only.** The branch moves with `force: false`, and each segment of its name is percent-encoded, so a head named `main#x` cannot address `main`. Commits are chained on the head the chase checked out, and a head that moved in the meantime is `superseded`.
- **Regular files only.** Any mode other than `100644` and `100755` (a symlink, a submodule) is refused, as is a changed path with no index entry.
- **The model's own edits only.** The index minus the clean checkout (A) is pushed, and only when the install and the checks left the tree as they found it (B equals C). The install is frozen.
- **No workflows.** Any path under `.github/workflows/`, a deletion included, is refused. A chase does not change CI itself, and the App may lack the `workflows` permission.
- **At most 50 files,** no absolute path, no `..`, no `.git` or `node_modules` segment.
- **Write access first.** A repository where the App cannot write is refused before the loop.
- **Own fix.** The app never chases a head whose commit is the App's own, and fails closed when GitHub cannot name the commit's author.
- **Results per chase.** The CI turn reads the chase's result under its chase key (the run and the attempt that failed, the key the rerun record uses), so one pull request's result is never read for another's.

**Not bounded:**

- **The budget counters are in memory.** Three chases a day and one per head live in the runtime's memory (`docs/notes.md`). A cold start or a second instance forgets them: it will allow three more that day, and does not know a head was chased. The lasting guard is the own-fix refusal, which reads GitHub on every claim, so a fix-fail-fix loop stops after one round even across cold starts. A durable store is a change to one file (`budget.ts`); this unit does not build one.
- **The sandbox allow-list has not been seen to hold.** The Docker backend honors only `allow-all` and `deny-all`, and Vercel Sandbox answers 402 until 2026-11-01. The npm allow-list is written and unverified.
- **The model's fix itself.** The checks must pass, but passing is the project's own definition of right. A fix can satisfy the checks and still be the wrong change, and an edit to a test or a check's configuration that makes it pass is for the maintainer to catch when they read the diff. The instructions forbid it; no code does.
- **A request with no pull request behind it.** A maintainer asking in Slack, or on an issue, cannot start a chase, so there is no way to hand the chase a pull request by name from there. Allowing it needs a signed admission or an approval card; neither is built.

## What it never does

It never merges, rebases, force-pushes, closes, approves or comments. It never touches a branch other than the pull request's head or its own `baymi/chase/` branch. It never runs code outside its sandbox, and never on a fork's pull request. It never pushes a change the checks did not pass on. It never chases a head twice in one runtime's day, and the app never chases a head that is its own fix gone red again.

## Limits

`agent/lib/chase/budget.ts`:

- **Three chases a UTC day**, across every repository. The fourth is refused.
- **One chase per pull request head.** A second red check on the same head does not start a second chase.
- **25 sandbox minutes per chase,** counted from the checkout. Every command is bounded by what is left (at most ten minutes each), and once it is spent the tools refuse and the chase stops as `partial`.
- **The app never chases its own fix.** When the head commit is one the App authored, or GitHub cannot say who did, the chase that made it failed or may have; the maintainer hears instead of a loop.

The claim is made before the chase starts and never released, and a store that cannot answer refuses the chase. The counters are in memory: a cold start forgets them, which the own-fix refusal, read from GitHub each time, bounds. Where the counters live, and why, is in `docs/notes.md`.

Model output is capped at 150,000 tokens per chase session. A direct Anthropic model reports no cost to eve, so the token cap is the only spend limit eve enforces.

## What the CI turn says

The tool's result (`agent/lib/chase/result.ts`) carries the status, the branch, the commits, the checks with pass or fail, what was not verified, and why. The channel reads it off the tool's `action.result` and the end of the turn renders it (`agent/lib/github/ci/settle.ts`):

- **Pushed, or opened as a pull request against the branch:** no Slack line. The checks run again on their own, and the digest counts it. The log says `fixed, CI rerunning`.
- **Failed, did not reproduce, ran out of time, was refused, or the App cannot write (`no-write-access`):** one Thai line, the pull request link first, saying it is blocked on PunGrumpy, with why the chase stopped.
- **A head another chase already took, or a head that moved:** nothing; the first chase or the new head's checks speak for it.
- **No result reached the end of the turn:** the `own-code` line as before, so a lost record pings rather than hides a red pull request.

A push is believed only when GitHub shows it: the tool reads the pull request's head after the subagent answers, and a claimed push that is not the head becomes a failure.

## What it needs in production

- **`ANTHROPIC_API_KEY`** in the Vercel project's server environment. Unit M1 makes it required at boot; until then the tool checks for it and refuses without it.
- **Contents read and write** on the App, which it already has, and a branch protection rule on each default branch, which the installed repositories have (2026-10-02). Without write the chase cannot push or open a pull request; the gate probes for it and ends the chase as `no-write-access` before anything runs. The App needs no `workflows` permission, and a chase never touches that folder.
- **Sandbox quota.** Each chase is one two-vCPU sandbox for up to 25 minutes, against Hobby's 5 active CPU hours and 420 GB-hours a month (`docs/notes.md`).
- **The CI events** (`check_run`, `workflow_run`) and Actions read on the App, which the CI turn already needs (gate G3).
