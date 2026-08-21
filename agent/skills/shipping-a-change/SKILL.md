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

4. **Run what the repository runs.** Its CI workflow is the list, not your assumption: read `.github/workflows/` and run those commands, then its `package.json` scripts and its `AGENTS.md` or contributing guide for anything CI does not cover. Every one of them exits 0 before you commit, or the reason it did not goes in the pull request body.

5. **Commit.** One coherent change per commit, message in the repository's own convention. Where that convention is Conventional Commits, read the type and scope vocabulary out of the repository (its pull request template, or the title-validation job in `.github/workflows/`) rather than inventing a scope that merely sounds right. A scope the repository does not define is how a title fails validation. When a change is cross-cutting, no scope is the correct answer.

6. **Push with `git_push`**, passing the branch and the `owner/repo`.

7. **Open the pull request** with `github__createPullRequest`. Title states the change in the repository's commit convention. Load `writing-quality` before drafting the body: it is prose meant for a human reader and the same rules apply. The body says what the change does and why, what was checked, and what was not.

8. **Read CI back.** A pull request is not finished when it is open. Wait for the checks to settle, read them, and fix what is red before you report the pull request as ready. Announcing a pull request while a required check is failing costs the reviewer the review, and the title-validation job is the check your own title most often breaks. If a bot comment is noise the repository does not act on, say so once rather than chasing it.

## Being honest in the pull request

A check that failed, or that could not be run at all, is stated plainly in the body. Never describe a check as passing because it usually passes, and never quietly drop one that failed. A reviewer who finds out from CI what the body should have told them stops trusting the body.

The same goes for scope: if the change fixes the symptom and not the cause, say so and say what the cause looks like.

## What not to do

- Do not push to `main` or `master`. The tool refuses it, and routing around the refusal is not the goal.
- Do not bundle unrelated changes. Two fixes are two pull requests.
- Do not open a pull request to fix something nobody reported.
- Do not rewrite code you were not asked to touch because you would have written it differently.
- Do not claim a test passed when the run was skipped or errored.
- Do not report the pull request as ready before its checks have settled.
