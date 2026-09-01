import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";

import { isAutonomous } from "#lib/trust";

/**
 * Who answers for a GitHub write, decided from the session rather than from the
 * tool name alone.
 *
 * @remarks
 * Two questions, in order. Is anyone there? An unattended triage turn has no
 * one to ask: an approval prompt on that turn is posted as a comment on a
 * stranger's issue and then waits for an answer nobody knows to give, so every
 * write it reaches for is refused outright instead. Then, for a turn someone
 * started: what does this write leave behind for someone else to find? The
 * comment a session exists to post and the labels a triage pass applies are
 * the substance of the reply and are reversible in one click, so gating them
 * would strand the thread; everything durable keeps its approval card.
 *
 * The lists are exhaustive over `GITHUB_WRITES`, and the colocated test is
 * what holds them that way. A write with no entry here falls back to the
 * extension's default, which is an approval card, and that is exactly the
 * prompt an unattended turn cannot answer.
 */

/** Why an unattended turn is refused a write rather than asked about one. */
export const AUTONOMOUS_WRITE_DENIAL =
  "This turn is unattended: it may read and post its one reply, and nothing else. Say what you would have done in that reply and leave it for a maintainer.";

const DENIED: ApprovalStatus = {
  reason: AUTONOMOUS_WRITE_DENIAL,
  type: "denied",
};

/**
 * The writes that carry a conversation: the comment answering the thread, the
 * labels placing an issue. An attended turn runs these without a card.
 */
export const CONVERSATION_WRITES = [
  "addIssueComment",
  "addLabels",
  "addPullRequestComment",
  "removeLabel",
] as const satisfies readonly GithubWriteToolName[];

/**
 * The other mounted writes, `createPullRequest` aside. Each puts something
 * durable in front of someone else, so an attended turn confirms it on a card
 * first.
 */
export const GATED_WRITES = [
  "closeIssue",
  "createIssue",
] as const satisfies readonly GithubWriteToolName[];

/**
 * The slice of eve's `ApprovalContext` a write policy reads.
 *
 * @remarks
 * Narrower than the context eve passes, which is what makes these policies
 * callable from a test without standing up a session: a function that only
 * asks for the calling principal still satisfies `ApprovalPolicy`.
 */
export interface WriteApprovalContext {
  readonly session: {
    readonly auth: { readonly current: SessionAuthContext | null };
  };
  readonly toolInput?: PullRequestInput;
}

/**
 * The slice of a write tool's input these policies read.
 *
 * @remarks
 * `draft` is `unknown` rather than `boolean` because the value arrives from
 * the model, and the only thing that may follow from it is an exemption: the
 * policy tests for `true` and treats anything else, including a string
 * `"true"`, as not a draft.
 */
export interface PullRequestInput {
  readonly draft?: unknown;
}

/** A conversation write: refused when unattended, uncarded otherwise. */
export const conversationWrite = (
  auth: SessionAuthContext | null
): ApprovalStatus => (isAutonomous(auth) ? DENIED : "not-applicable");

/** Any other write: refused when unattended, carded otherwise. */
export const gatedWrite = (auth: SessionAuthContext | null): ApprovalStatus =>
  isAutonomous(auth) ? DENIED : "user-approval";

/**
 * Opening a pull request, which runs without a card when the pull request is
 * a draft.
 *
 * @remarks
 * The branch is the durable part and it has already landed. `git_push` runs
 * uncarded on every turn a person started, so carding the pull request that
 * describes that branch confirms nothing the push did not. A draft cannot
 * merge, marking one ready stays a human act, and the review is the
 * confirmation. A pull request that is ready to merge still asks, whoever
 * asked for it.
 *
 * A scheduled sweep is the case that made this exemption necessary, and it is
 * no longer the only one. Someone can answer a card only while the session
 * that raised it is alive, and that fails from both ends. A sweep fires while
 * nobody is watching Slack. An attended turn that dies mid-flight leaves its
 * card behind, and the click then arrives for a session eve can no longer
 * find, which `docs/notes.md` records. Neither one is a confirmation.
 */
export const pullRequestWrite = (
  auth: SessionAuthContext | null,
  input: PullRequestInput | undefined
): ApprovalStatus => {
  if (isAutonomous(auth)) {
    return DENIED;
  }
  return input?.draft === true ? "not-applicable" : "user-approval";
};

/** What the extension is handed for one write tool. */
type WritePolicy = (ctx: WriteApprovalContext) => ApprovalStatus;

const policyFor = (
  tools: readonly GithubWriteToolName[],
  decide: (auth: SessionAuthContext | null) => ApprovalStatus
): Partial<Record<GithubWriteToolName, WritePolicy>> =>
  Object.fromEntries(
    tools.map((tool) => [
      tool,
      (ctx: WriteApprovalContext) => decide(ctx.session.auth.current),
    ])
  );

/**
 * The per-tool approval map the GitHub extension is mounted with, built from
 * the two lists above so the classification is stated once.
 */
export const githubWriteApprovals = () => {
  const createPullRequest: WritePolicy = (ctx) =>
    pullRequestWrite(ctx.session.auth.current, ctx.toolInput);
  return {
    ...policyFor(CONVERSATION_WRITES, conversationWrite),
    ...policyFor(GATED_WRITES, gatedWrite),
    createPullRequest,
  };
};
