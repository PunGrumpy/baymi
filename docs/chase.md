# Chase

Status: built (`agent/subagents/chase/`, `agent/lib/chase/`, `agent/tools/chase_pull_request.ts`). Run live on a scratch pull request at the maintainer's request, with a local Docker sandbox: it reproduced a failing test, fixed it, passed the checks and pushed one commit, and the pull request's CI went from red to green (`docs/notes.md` has the run, its cost and the two bugs it found first). The CI turn's hand-off has unit tests but has not run live. It replaces the remediation subagent, which eve 0.62.0 never offered.

## What it does

When a pull request's own code fails its checks, the chase takes it to green. It reproduces the failing check with the project's own scripts in a sandbox of its own, makes the smallest change that makes it pass, runs every check again, and pushes the fix as atomic commits to the pull request's branch. When it may not push there, it opens a pull request against that branch instead.

Two callers start one:

- **The CI turn.** A red check on the maintainer's pull request starts an app turn (`agent/lib/github/ci/`). When the classifier says the diff's own code failed (`own-code`), the turn's brief tells the model to call `chase_pull_request` once. Every other kind (a flake, a stale base, an external check) is handled as before and never reaches the chase.
- **The maintainer.** On GitHub or Slack, PunGrumpy can ask Baymi to chase a pull request by hand.

Nobody else can: not a collaborator, not the reviewer, not a stranger, and not `local-dev`, which is the maintainer for everything else but must not push to a real repository from a local eval (`mayChase` in `agent/lib/trust.ts`).

Dependency bumps are not the chase's job. Dependabot security updates open them upstream, and a Dependabot pull request whose checks go red is a pull request the chase takes to green like any other.

## Why it cannot run inside the review

The review agent is read-only for a reason recorded in `ARCHITECTURE.md`. Its sandbox holds a checkout of a pull request a stranger may have written, and eve attaches the installation token to that sandbox's requests to `github.com`. The chase needs a shell, because it installs packages and runs the type checker and the tests, so it lives where the token never reaches.

## The shape

- **`chase_pull_request`** (`agent/tools/`) is the only way in. It is a static workflow tool: eve 0.62.0 refuses a provider object and `defaultTools: false` from a dynamic subagent, so the subagent is static with `tool: false`, and only a workflow tool can call a hidden subagent by name. Its approval policy refuses every class but the app and the maintainer before it runs. Its first step, in the app runtime, admits the request (`agent/lib/chase/gate.ts`) and claims the budget. Then it calls the subagent with `ctx.agent("chase", ...)` and waits for its structured result. eve also refuses a tool and a subagent with the same public name, `tool: false` or not, which is why the tool's name is longer.
- **The subagent** (`agent/subagents/chase/`) runs on Claude Sonnet 5.5, called on Anthropic directly with `ANTHROPIC_API_KEY`, at effort `high`. It has `bash`, `read_file`, `write_file`, `glob` and `grep` in its own sandbox, plus four tools of its own. It has no GitHub connection and no GitHub tools.
- **The sandbox** has two vCPUs and reaches `registry.npmjs.org` and `registry.yarnpkg.com`, nothing else. GitHub is not on the list: the runtime downloads the head and pushes the fix itself.
- **`prepare_checkout`** reads the pull request with the installation token, refuses anything but the open pull request at the head the tool admitted, downloads that commit's archive (200 MiB at most) and writes the bytes into the sandbox. The pull request, its head and its branch go into durable session state, which the sandbox cannot reach and the model cannot edit. The sandbox clock starts here.
- **`run_checks`** installs with lifecycle scripts off and runs the project's `typecheck`, `check`, `lint` and `test` scripts, whichever exist, with fixed commands, and records the exit codes in state. The first run is the reproduction.
- **`push_fix`** takes the commits the model proposes (a message and the files for each), refuses anything the checks did not pass on, and pushes from the app runtime through the Git Data API.
- **`stop_chase`** ends a chase that will not push and reports why, with the end of the failing output.

## The fix loop

Condensed from the bug-fix playbook, and enforced by the tools rather than only asked for:

1. **Reproduce first.** `run_checks` runs once before any edit. If every check passes, the failure did not reproduce here, and the chase stops (`not-reproduced`). A fix is only ever verified against a failure that run saw.
2. **Smallest change.** The instructions ask for the change the failure needs and nothing else, and forbid deleting, skipping or weakening a test.
3. **Run the full set.** Every attempt runs every check, not only the one that failed.
4. **Two attempts.** `run_checks` runs at most three times: the reproduction and two attempts. If the second attempt still fails, the chase stops and reports the captured output.

A fix is verified (`fixVerdict` in `agent/lib/chase/checks.ts`) only when the reproduction failed, a later run passed every check, and the change has not moved since that run, which a digest of the change taken before the checks and again at push decides. `push_fix` refuses anything else; there is no unverified push.

## Where the fix goes

`planPush` in `agent/lib/chase/branch.ts`, decided from GitHub at the moment of the push, after reading the pull request again:

- **The head moved** while the chase worked: someone pushed newer work. Nothing is pushed (`superseded`).
- **Same repository, writable, unprotected, not the default branch:** the commits are chained on the head and the branch is fast-forwarded to the last one with `force: false`. GitHub refuses that unless the new commit descends from the branch's head, so nothing is ever rewritten.
- **A protected head branch, or the default branch,** or a fast-forward GitHub refused: a `baymi/chase/<pr>-<short sha>` branch is created at the fix, and a pull request is opened from it against the head branch.
- **A fork:** nothing. The fork is a repository the App is not installed on, so it can neither push there nor open a pull request into it. The gate refuses a fork before any sandbox runs.
- **No write access:** GitHub answers the fast-forward with 403, and the chase reports it without pushing anywhere. The repository's `permissions` field cannot tell in advance: for an installation token it reads all false.

Commits are Conventional Commits: `type(scope): imperative summary`, a blank line, and a body saying what failed and what changed. `push_fix` refuses a message without that shape, and one with a co-author trailer or a generated-by line (`agent/lib/chase/message.ts`). Every changed file goes in exactly one commit. The App is the author.

## What it never does

It never merges, rebases, force-pushes, closes, approves or comments. It never touches a branch other than the pull request's head or its own `baymi/chase/` branch. It never runs code outside its sandbox, and never on a fork's pull request. It never pushes a change the checks did not pass on. It never chases a head twice, and the app never chases a head that is its own fix gone red again.

## Limits

`agent/lib/chase/budget.ts`:

- **Three chases a UTC day**, across every repository. The fourth is refused.
- **One chase per pull request head.** A second red check on the same head does not start a second chase.
- **25 sandbox minutes per chase,** counted from the checkout. Every command is bounded by what is left (at most ten minutes each), and once it is spent the tools refuse and the chase stops as `partial`.
- **The app never chases its own fix.** When the head commit is one the App authored, the chase that made it failed; the maintainer hears instead of a loop.

The claim is made before the chase starts and never released, and a store that cannot answer refuses the chase. Where the counters live, and why, is in `docs/notes.md`.

Model output is capped at 150,000 tokens per chase session. A direct Anthropic model reports no cost to eve, so the token cap is the only spend limit eve enforces.

## What the CI turn says

The tool's result (`agent/lib/chase/result.ts`) carries the status, the branch, the commits, the checks with pass or fail, what was not verified, and why. The channel reads it off the tool's `action.result` and the end of the turn renders it (`agent/lib/github/ci/settle.ts`):

- **Pushed, or opened as a pull request against the branch:** no Slack line. The checks run again on their own, and the digest counts it. The log says `fixed, CI rerunning`.
- **Failed, did not reproduce, ran out of time, or was refused:** one Thai line, the pull request link first, saying it is blocked on PunGrumpy, with why the chase stopped.
- **A head another chase already took, or a head that moved:** nothing; the first chase or the new head's checks speak for it.
- **No result reached the end of the turn:** the `own-code` line as before, so a lost record pings rather than hides a red pull request.

A push is believed only when GitHub shows it: the tool reads the pull request's head after the subagent answers, and a claimed push that is not the head becomes a failure.

## What it needs in production

- **`ANTHROPIC_API_KEY`** in the Vercel project's server environment. Unit M1 makes it required at boot; until then the tool checks for it and refuses without it.
- **Contents read and write** on the App, which it already has, and a branch protection rule on each default branch, which the installed repositories have (2026-10-02). Without write the chase cannot push or open a pull request, and says so.
- **Sandbox quota.** Each chase is one two-vCPU sandbox for up to 25 minutes, against Hobby's 5 active CPU hours and 420 GB-hours a month (`docs/notes.md`).
- **The CI events** (`check_run`, `workflow_run`) and Actions read on the App, which the CI turn already needs (gate G3).
