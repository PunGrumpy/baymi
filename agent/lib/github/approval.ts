import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools";

import { isAutonomous, isScheduleAppAuth } from "#lib/trust";

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
 * Opening a pull request, which a scheduled sweep does without a card as long
 * as the pull request is a draft.
 *
 * @remarks
 * A sweep fires while nobody is watching Slack, so a card there is not a
 * confirmation, it is a session parked until someone happens to look. A draft
 * cannot merge and marking one ready stays a human act, so the review itself
 * is the confirmation and the branch is already the deliverable. A sweep that
 * wants a non-draft pull request still asks.
 */
export const pullRequestWrite = (
  auth: SessionAuthContext | null,
  input: PullRequestInput | undefined
): ApprovalStatus =>
  isScheduleAppAuth(auth) && input?.draft === true
    ? "not-applicable"
    : gatedWrite(auth);

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
