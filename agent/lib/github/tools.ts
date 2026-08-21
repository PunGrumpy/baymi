import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";

/**
 * The GitHub tools this agent is mounted with, and nothing else.
 *
 * @remarks
 * Every tool here is carried in the prompt on every turn, whatever the turn is
 * about. The `maintainer` preset is 79 of them, about 21,800 tokens before the
 * agent has read a word of the conversation, and most of it is capability
 * nothing in `agent/instructions.md` or any skill ever reaches for. This list
 * is what those procedures actually name or plainly need, at 7,600.
 *
 * Three of the omissions are worth stating, because the tool existed only to
 * be refused: `createOrUpdateFile` (code ships from the sandbox checkout, not
 * through the API), `createLabel` (the triage playbook works from the repo's
 * existing vocabulary), and `createPullRequestReview` (approving and
 * requesting changes are a person's act). The workflow tools go because CI is
 * read through `listCheckRuns` and `getCiFailureContext`; branches because a
 * branch is made with git in the sandbox; notifications, discussions,
 * reactions, releases beyond a listing, forks, and every delete because no
 * procedure here has ever asked for one.
 *
 * Adding one back is a line here plus, for a write, a line in
 * `agent/lib/github/approval.ts`; the colocated test fails until both exist.
 */

/** Reads. Free of consequence, and most of a turn is made of them. */
const GITHUB_READS = [
  "getBlame",
  "getCiFailureContext",
  "getFileContent",
  "getIssueContext",
  "getPullRequestContext",
  "getRepository",
  "getRepositoryTree",
  "listCheckRuns",
  "listCommits",
  "listIssueComments",
  "listIssues",
  "listLabels",
  "listPullRequestFiles",
  "listPullRequests",
  "listReleases",
  "searchCode",
  "searchIssues",
] as const;

/**
 * Writes. Each one needs a policy in `agent/lib/github/approval.ts`, which is
 * what decides whether it runs, asks, or is refused.
 */
export const GITHUB_WRITES = [
  "addIssueComment",
  "addLabels",
  "addPullRequestComment",
  "closeIssue",
  "createIssue",
  "createPullRequest",
  "removeLabel",
] as const satisfies readonly GithubWriteToolName[];

/** The mounted set, in the shape the extension's `include` takes. */
export const GITHUB_TOOLS = [...GITHUB_READS, ...GITHUB_WRITES];
