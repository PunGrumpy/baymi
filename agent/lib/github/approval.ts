import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";

import { isUnattended } from "#lib/trust";

/**
 * Who answers for a GitHub write, decided from the session rather than from
 * the tool name alone.
 *
 * @remarks
 * Two questions, in order. Is anyone there? An unattended review has no one
 * to ask: an approval prompt on that turn is posted as a comment on somebody
 * else's pull request and then waits for an answer nobody knows to give, so
 * every write it attempts is refused outright instead. Then, for a turn a
 * trusted person started: what does this write leave behind? A comment on
 * another thread is the substance of an answer and reversible in one click,
 * so it runs uncarded; an issue is durable and asks first.
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

/** A conversation write: refused when unattended, uncarded otherwise. */
export const conversationWrite = (
  auth: SessionAuthContext | null
): ApprovalStatus => (isUnattended(auth) ? DENIED : "not-applicable");

/** A durable write: refused when unattended, carded otherwise. */
export const gatedWrite = (auth: SessionAuthContext | null): ApprovalStatus =>
  isUnattended(auth) ? DENIED : "user-approval";
