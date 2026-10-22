import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";

import { checkRerun, parseRerunInput } from "#lib/github/rerun";
import type { ReadGitHub } from "#lib/github/rerun";
import { isUnattended } from "#lib/trust";

/**
 * Who answers for a GitHub write, decided from the session rather than from
 * the tool name alone.
 *
 * @remarks
 * Two questions, in order. Is anyone there? An unattended turn, which is the
 * review or the app acting on its own clock, has no one to ask: an approval
 * prompt on a review is posted as a comment on somebody else's pull request
 * and waits for an answer nobody knows to give, and a task-mode schedule
 * cannot park for one at all, so every write it attempts is refused outright
 * instead. Then, for a turn a trusted person started: what does this write
 * leave behind? A comment on another thread is the substance of an answer and
 * reversible in one click, so it runs uncarded; an issue is durable and asks
 * first.
 *
 * The workflow rerun is neither: a second call starts a second attempt, so its
 * policy reads the attempt from GitHub before it lets the call through
 * (`agent/lib/github/rerun.ts`).
 *
 * The lists are exhaustive over `GITHUB_WRITES`, and the colocated test holds
 * them that way. A write with no entry here falls back to the extension's
 * default, which is an approval card, and that is exactly the prompt an
 * unattended turn cannot answer.
 */

/** Why an unattended turn is refused a write rather than asked about one. */
export const UNATTENDED_WRITE_DENIAL =
  "This turn is unattended: it may read and post its one reply. Say what you would have done in the reply and leave it there.";

const DENIED: ApprovalStatus = {
  reason: UNATTENDED_WRITE_DENIAL,
  type: "denied",
};

/**
 * The writes that continue a conversation on another thread. An attended turn
 * runs these without a card: the mention gate already confirmed who asked.
 */
export const CONVERSATION_WRITES = [
  "addIssueComment",
  "addPullRequestComment",
  "replyToReviewComment",
] as const satisfies readonly GithubWriteToolName[];

/** The writes that put something durable in front of someone else. */
export const GATED_WRITES = [
  "createIssue",
] as const satisfies readonly GithubWriteToolName[];

/** The write that starts another attempt of a workflow run. */
export const RERUN_WRITES = [
  "rerunWorkflowRun",
] as const satisfies readonly GithubWriteToolName[];

/** Why a turn that is not a person's is refused a rerun. */
export const RERUN_PRINCIPAL_DENIAL =
  "Only a turn the maintainer started may rerun a workflow. Say which run failed and what the failure looks like, and leave the rerun to them.";

/** Why a rerun call is refused when its input names no run. */
export const RERUN_INPUT_DENIAL =
  "The rerun names no run Baymi can check, so it was not rerun. Pass the owner, repo and runId of the failed run.";

/**
 * Whether this turn may rerun a workflow: a person asked, in a session that
 * is not an unattended review.
 *
 * @remarks
 * `trust.ts` cannot name the app's own scheduled or CI turns yet (unit L2 of
 * the engineering-lead program adds that class), so until it does only a
 * person qualifies. The channels admit only trusted people to a session at
 * all, which makes a `user` principal the maintainer or someone the
 * maintainer trusts with the repository.
 */
const mayRerun = (auth: SessionAuthContext | null): boolean =>
  auth !== null && !isUnattended(auth) && auth.principalType === "user";

/** A conversation write: refused when unattended, uncarded otherwise. */
export const conversationWrite = (
  auth: SessionAuthContext | null
): ApprovalStatus => (isUnattended(auth) ? DENIED : "not-applicable");

/** A durable write: refused when unattended, carded otherwise. */
export const gatedWrite = (auth: SessionAuthContext | null): ApprovalStatus =>
  isUnattended(auth) ? DENIED : "user-approval";

/**
 * A workflow rerun: refused for any turn that is not a person's, then for any
 * run GitHub says Baymi has already rerun, or that is not a failure of the
 * pull request's current head. Uncarded when it passes, because the guard is
 * the check a card would have been.
 */
export const rerunWrite = async (
  auth: SessionAuthContext | null,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- eve types an approval policy's tool input as a record of unknown, and `parseRerunInput` is where it is parsed
  toolInput: Readonly<Record<string, unknown>> | undefined,
  read: ReadGitHub
): Promise<ApprovalStatus> => {
  if (!mayRerun(auth)) {
    return { reason: RERUN_PRINCIPAL_DENIAL, type: "denied" };
  }
  const input = parseRerunInput(toolInput);
  if (input === null) {
    return { reason: RERUN_INPUT_DENIAL, type: "denied" };
  }
  const verdict = await checkRerun(input, read);
  return verdict.ok
    ? "not-applicable"
    : { reason: verdict.reason, type: "denied" };
};
