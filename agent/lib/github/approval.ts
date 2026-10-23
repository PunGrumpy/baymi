import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";

import { checkRerun, parseRerunInput } from "#lib/github/rerun";
import type { ReadGitHub } from "#lib/github/rerun";
import type { TrustClass } from "#lib/trust";
import { classifyPrincipal, isLocalDev, isUnattended } from "#lib/trust";

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
 * (`agent/lib/github/rerun.ts`), and it is the one write the app may do on its
 * own clock.
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

/** Why a turn that may not rerun is refused one. */
export const RERUN_PRINCIPAL_DENIAL =
  "Only the maintainer, or the app on its own schedule or a CI event, may rerun a workflow. Say which run failed and what the failure looks like, and leave the rerun to the maintainer.";

/** Why a rerun call is refused when its input names no run. */
export const RERUN_INPUT_DENIAL =
  "The rerun names no run Baymi can check, so it was not rerun. Pass the owner, repo and runId of the failed run.";

/**
 * Who may rerun a workflow, by class. Exhaustive over `TrustClass`, so a new
 * kind of caller does not compile until someone decides whether it may.
 *
 * - `maintainer` is the person the lead works for.
 * - `app` is the lead on its own clock: the digest, or a CI event it was woken
 *   by. It is unattended, so no one reads a card; see `mayRerun`.
 * - `collaborator` is refused. A mention admits them to one conversation, but
 *   the rerun names any repository the App is installed on and is not bound to
 *   the one they were admitted to, so it stays the maintainer's.
 * - `reviewer` reads a stranger's diff and is refused everything with a side
 *   effect. `stranger` is no caller we know, `null` included.
 */
const RERUN_BY_CLASS = {
  app: true,
  collaborator: false,
  maintainer: true,
  reviewer: false,
  stranger: false,
} as const satisfies Record<TrustClass, boolean>;

/**
 * Whether this caller may ask for a rerun at all, before any run is looked at.
 *
 * @remarks
 * The class decides who, and the guard decides what. On the maintainer's turn
 * the guard bounds the damage of a misjudged call. On the app's turn it is the
 * only thing that makes the write safe: nobody reads that turn as it runs,
 * there is no card to answer, and the model has read job logs and pull request
 * titles that strangers wrote. So `rerunWrite` never returns an allow without
 * the guard's verdict, and this predicate alone is never the allow.
 */
const mayRerun = (auth: SessionAuthContext | null): boolean =>
  auth !== null && !isLocalDev(auth) && RERUN_BY_CLASS[classifyPrincipal(auth)];

/** A conversation write: refused when unattended, uncarded otherwise. */
export const conversationWrite = (
  auth: SessionAuthContext | null
): ApprovalStatus => (isUnattended(auth) ? DENIED : "not-applicable");

/** A durable write: refused when unattended, carded otherwise. */
export const gatedWrite = (auth: SessionAuthContext | null): ApprovalStatus =>
  isUnattended(auth) ? DENIED : "user-approval";

/**
 * A workflow rerun: refused for any turn that may not rerun (`mayRerun`), then
 * for any run GitHub says Baymi has already rerun, or that is not a failure of
 * the pull request's current head. Uncarded when it passes, because the guard
 * is the check a card would have been.
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
