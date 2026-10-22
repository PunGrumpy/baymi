import type { SessionAuthContext } from "eve/context";

import { isUnattendedReviewState } from "#lib/github/pull-requests";
import { isApp, isReviewer } from "#lib/trust";

/**
 * Which path a finished turn, or a dead one, takes on the GitHub channel.
 *
 * @remarks
 * The channel's reply path (`settleReply`, `postReply`) writes to the pull
 * request: a comment, a review, a summary, a check run. It was written for
 * two callers, a person who mentioned the agent and the review of a stranger's
 * pull request, and an app turn that reached it would post whatever the model
 * wrote as a public comment under the maintainer's pull request. Baymi's own
 * review of L2 named exactly that. So the app is branched off here, by class
 * and ahead of everything, and goes to the chase's own end, which writes to
 * Slack only (`./settle.ts`).
 *
 * The routes are functions of the auth or the channel state and nothing
 * else, so a test reaches every one of them without a channel.
 */

export type ReplyRoute = "chase" | "reply";

/** `message.completed`: the app is a chase, anyone else is a reply to post. */
export const replyRoute = (auth: SessionAuthContext | null): ReplyRoute =>
  isApp(auth) ? "chase" : "reply";

/**
 * Runs the one path the turn's caller belongs on and never the other.
 *
 * @remarks
 * `reply` stands for `settleReply`, which reaches `postReply`. The app never
 * calls it, so nothing a chase turn says can land on the pull request.
 */
export const routeCompletedMessage = async <Message>(input: {
  readonly auth: SessionAuthContext | null;
  readonly chase: (message: Message) => Promise<void>;
  readonly message: Message;
  readonly reply: (message: Message) => Promise<void>;
}): Promise<ReplyRoute> => {
  const route = replyRoute(input.auth);
  await (route === "chase"
    ? input.chase(input.message)
    : input.reply(input.message));
  return route;
};

/** `turn.failed`: the review and the chase are told apart from a person's turn. */
export type TurnFailureRoute = "notice" | "quiet";

export const turnFailureRoute = (
  auth: SessionAuthContext | null
): TurnFailureRoute => (isReviewer(auth) || isApp(auth) ? "quiet" : "notice");

/** The slice of channel state `session.failed` is judged from. */
export interface SessionAnchor {
  readonly headRef: string | null;
  readonly pullRequestNumber: number | null;
  readonly reviewCommentId: number | null;
  readonly triggeringCommentId: number | null;
}

/**
 * Whether the session was opened by a CI event.
 *
 * @remarks
 * `session.failed` receives no auth, so the state answers. A CI dispatch is
 * anchored to a pull request with no comment behind it, like a review, but
 * eve builds its state without the head ref that a `pull_request` event
 * carries, and the built-in checkout never fills it in. A session a review
 * opened keeps the review's state when a CI event joins it (`docs/notes.md`),
 * so this is true only for a session the chase opened itself.
 */
export const isCiSessionState = (state: SessionAnchor): boolean =>
  state.pullRequestNumber !== null &&
  state.triggeringCommentId === null &&
  state.reviewCommentId === null &&
  state.headRef === null;

export type SessionFailureRoute = "chase" | "notice" | "review";

export const sessionFailureRoute = (
  state: SessionAnchor
): SessionFailureRoute => {
  if (isCiSessionState(state)) {
    return "chase";
  }
  return isUnattendedReviewState(state) ? "review" : "notice";
};
