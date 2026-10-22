import type {
  GithubToolName,
  GithubWriteToolName,
} from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";

import { REVIEWER_PRINCIPAL } from "#lib/trust";

/**
 * The GitHub tools this agent is mounted with, and nothing else.
 *
 * @remarks
 * Every tool here is in the prompt on every turn that is offered it, whatever
 * the turn is about, and the gateway this agent answers through degrades as
 * the tool list grows (`docs/notes.md`). So the list is what the procedures
 * actually use. On a GitHub turn the repository is checked out in the
 * sandbox, and `read_file`, `glob` and `grep` cover the code; these tools are
 * for what the checkout does not hold (the pull request itself, another pull
 * request, an issue) and for Slack, where there is no checkout.
 *
 * The CI tools are here for the engineering-lead role: find the maintainer's
 * open pull requests across repositories (`searchIssues`), then read a ref's
 * check runs and combined status, its workflow runs and their jobs, and a
 * failed job's log tail. `getCiFailureContext` is the one-call version of
 * that chain and what the model should reach for first. `rerunWorkflowRun` is
 * the one CI write, and its policy refuses everything but the first rerun of
 * a failed run on the pull request's current head
 * (`agent/lib/github/rerun.ts`). They cost about two thousand tokens a turn
 * (`docs/notes.md`), and a review turn reads a stranger's diff and has no use
 * for them, so `toolsForTurn` takes them out of that turn's prompt.
 *
 * The notable omissions: no `mergePullRequest`, because a merge is the
 * maintainer's click and no policy is as strong as no tool; no
 * `cancelWorkflowRun` or `triggerWorkflow`, because stopping or starting CI
 * is not what a lead that reports needs; no `createPullRequestReview`,
 * because approving and requesting changes are a person's act, and the
 * review with its inline comments is submitted by the channel from the reply
 * (`agent/lib/github/review.ts`) rather than by a tool; no `addLabels`,
 * `closeIssue` or assignment, because a companion that says what it found
 * and leaves the decision alone needs none of them; no file-writing tool at
 * all, because this agent never changes a repository.
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
 * Reads of CI and of pull requests across repositories. Kept apart from
 * `GITHUB_READS` so the cost of the lead role is one line to find and one
 * line to drop.
 */
export const GITHUB_CI_READS = [
  "getCiFailureContext",
  "getCombinedStatus",
  "getWorkflowJobLogs",
  "listCheckRuns",
  "listWorkflowJobs",
  "listWorkflowRuns",
  "searchIssues",
] as const satisfies readonly GithubToolName[];

/**
 * Writes. Each one needs a policy in `agent/lib/github/approval.ts`, which is
 * what decides whether it runs, asks, or is refused.
 */
export const GITHUB_WRITES = [
  "addIssueComment",
  "addPullRequestComment",
  "createIssue",
  "replyToReviewComment",
  "rerunWorkflowRun",
] as const satisfies readonly GithubWriteToolName[];

/** The mounted set, in the shape the extension's `include` takes. */
export const GITHUB_TOOLS = [
  ...GITHUB_READS,
  ...GITHUB_CI_READS,
  ...GITHUB_WRITES,
];

/** Every tool that exists for CI, which a review turn is not offered. */
export const GITHUB_CI_TOOLS: readonly string[] = [
  ...GITHUB_CI_READS,
  "rerunWorkflowRun",
];

/**
 * Whether this turn is the app reviewing a pull request nobody asked it to
 * read.
 *
 * @remarks
 * `isUnattended` answers a wider question than this one. Unit L2 of the
 * engineering-lead program extends it to the app's own scheduled and CI
 * turns, and those are the turns that read CI, so withholding the CI tools
 * by `isUnattended` would take them from exactly the caller they are for.
 * This asks for the reviewer by name until the trust classifier lands.
 */
const isReviewTurn = (auth: SessionAuthContext | null): boolean =>
  auth !== null && auth.principalId === REVIEWER_PRINCIPAL;

/**
 * The mounted tools a turn is offered: all of them, less the CI tools on a
 * review turn.
 *
 * @remarks
 * The extension takes a static `include`, so the cut happens where its
 * dynamic tool resolves (`agent/extensions/github/tools/github.ts`). A review
 * turn reads untrusted text already, and a job log is more of it; a tool it
 * is not offered is one it cannot be talked into calling.
 */
export const toolsForTurn = <Tool>(
  tools: Readonly<Record<string, Tool>>,
  auth: SessionAuthContext | null
): Record<string, Tool> =>
  isReviewTurn(auth)
    ? Object.fromEntries(
        Object.entries(tools).filter(
          ([name]) => !GITHUB_CI_TOOLS.includes(name)
        )
      )
    : { ...tools };
