import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";

/**
 * The GitHub tools this agent is mounted with, and nothing else.
 *
 * @remarks
 * Every tool here is included in the prompt on every turn, whatever the turn
 * is about, and the gateway this agent answers through degrades as the tool
 * list grows (`docs/notes.md`). So the list is what the procedures actually
 * use. On a GitHub turn the repository is checked out in the sandbox,
 * and `read_file`, `glob` and `grep` cover the code; these tools are for
 * what the checkout does not hold (the pull request itself, another pull
 * request, an issue) and for Slack, where there is no checkout.
 *
 * The notable omissions: no `createPullRequestReview`, because
 * approving and requesting changes are a person's act, and the review with
 * its inline comments is submitted by the channel from the reply
 * (`agent/lib/github/review.ts`) rather than by a tool; no `addLabels`, `closeIssue` or assignment, because a companion
 * that says what it found and leaves the decision alone needs none of them;
 * no file-writing tool at all, because this agent never changes a
 * repository.
 *
 * Adding a write back is a line here plus a policy in
 * `agent/lib/github/approval.ts`; the colocated test fails until both exist.
 */

/** Reads. Free of consequence, and most of a turn is made of them. */
const GITHUB_READS = [
  "getFileContent",
  "getIssueContext",
  "getPullRequestContext",
  "listPullRequestFiles",
  "listPullRequestReviewThreads",
  "listPullRequests",
  "searchCode",
] as const;

/**
 * Writes. Each one needs a policy in `agent/lib/github/approval.ts`, which is
 * what decides whether it runs, asks, or is refused.
 */
export const GITHUB_WRITES = [
  "addIssueComment",
  "addPullRequestComment",
  "createIssue",
  "replyToReviewComment",
] as const satisfies readonly GithubWriteToolName[];

/** The mounted set, in the shape the extension's `include` takes. */
export const GITHUB_TOOLS = [...GITHUB_READS, ...GITHUB_WRITES];
