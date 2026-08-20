---
description: "Procedure for carrying a code change through to a pull request: working in the sandbox checkout, running the repository's own checks, committing, pushing a branch with git_push, and opening the PR. Load whenever asked to fix, patch, or change code in a repository, or to open a pull request. Not for answering questions about code, reviewing an existing PR, or anything that stays inside the issue tracker."
---

# Shipping a change

A change ships from the sandbox checkout, never through the GitHub API. `createOrUpdateFile` writes a commit nobody ran anything against; the sandbox is where a change can be checked before it becomes a pull request.

## Before you start

**Someone has to have asked.** Noticing that something could be fixed is not a request to fix it. Say what you found and offer; an unrequested pull request costs a review nobody planned.

**Work only in a repository this agent follows.** `git_push` refuses anything else, and finding that out after writing the change wastes the whole turn.

## The order

1. **Read before writing.** The checkout is the real tree at the ref that triggered this session. Use `glob`, `grep` and `read_file` rather than the GitHub API: it is free, it is the code actually under discussion, and `grep` takes real expressions.

2. **Branch.** Off the default branch, named for the change: `fix/digest-empty-state`, not `patch-1`.

3. **A bug fix starts with the failing test.** Write the test that reproduces the bug and watch it fail before touching the fix. A fix whose test passed the first time has not been shown to fix anything.

4. **Run what the repository runs.** Read its `package.json` scripts and its `AGENTS.md` or contributing guide, then run the checks it defines rather than the ones you assume: typecheck, lint, tests. Follow its conventions for commit messages and changelog entries, read from the repository rather than recalled.

5. **Commit.** One coherent change per commit, message in the repository's own convention.

6. **Push with `git_push`**, passing the branch and the `owner/repo`.

7. **Open the pull request** with `github__createPullRequest`. Title states the change, body says what it does and why, what was checked, and what was not.

## Being honest in the pull request

A check that failed, or that could not be run at all, is stated plainly in the body. Never describe a check as passing because it usually passes, and never quietly drop one that failed. A reviewer who finds out from CI what the body should have told them stops trusting the body.

The same goes for scope: if the change fixes the symptom and not the cause, say so and say what the cause looks like.

## What not to do

- Do not push to `main` or `master`. The tool refuses it, and routing around the refusal is not the goal.
- Do not bundle unrelated changes. Two fixes are two pull requests.
- Do not open a pull request to fix something nobody reported.
- Do not rewrite code you were not asked to touch because you would have written it differently.
- Do not claim a test passed when the run was skipped or errored.
