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

/**
 * `turn.failed`: a person gets the public notice, the review waits for
 * `session.failed`, and the app tells Slack now, while its auth still says
 * which chase died.
 */
export type TurnFailureRoute = "chase" | "notice" | "quiet";

export const turnFailureRoute = (
  auth: SessionAuthContext | null
): TurnFailureRoute => {
  if (isApp(auth)) {
    return "chase";
  }
  return isReviewer(auth) ? "quiet" : "notice";
};

/** Whose turn failed last in this session. */
export type FailedTurn = "app" | "other";

/**
 * Where `turn.failed` records whose turn died, for `session.failed` to read.
 *
 * @remarks
 * `session.failed` receives no auth, and one session per pull request is
 * shared by a review, a mention and anything else sent to its address, so
 * the state that opened the session says nothing about who failed in it. A
 * chase has its own session (`./session.ts`), but an app turn that ever runs
 * in a shared one must still not post the mention's notice or rewrite the
 * review's check run. So `turn.failed`, which has the caller, writes the
 * caller's class into the durable channel state, a field of its own beside
 * eve's, and `turn.completed` clears it, so a later failure with no turn
 * behind it is judged by state again.
 */
export interface FailureMark {
  baymiFailedTurn?: FailedTurn | null;
}

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
 * carries, and the built-in checkout never fills it in. A chase is sent to a
 * session of its own (`./session.ts`), so its session always has this state.
 */
export const isCiSessionState = (state: SessionAnchor): boolean =>
  state.pullRequestNumber !== null &&
  state.triggeringCommentId === null &&
  state.reviewCommentId === null &&
  state.headRef === null;

/**
 * `session.failed`, from state alone: quiet when the app's turn died (it told
 * Slack at `turn.failed`), the chase's own line for a session a chase opened,
 * the review's path for a review's session, and the notice otherwise.
 */
export type SessionFailureRoute = "chase" | "notice" | "quiet" | "review";

/** The channel state as `turn.failed`, `turn.completed` and `session.failed` see it. */
export type MarkedState = FailureMark & SessionAnchor;

export const markFailedTurn = (
  state: MarkedState,
  auth: SessionAuthContext | null
): void => {
  state.baymiFailedTurn = isApp(auth) ? "app" : "other";
};

export const clearFailedTurn = (state: MarkedState): void => {
  state.baymiFailedTurn = null;
};

export const sessionFailureRoute = (
  state: MarkedState
): SessionFailureRoute => {
  if (state.baymiFailedTurn === "app") {
    return "quiet";
  }
  if (isCiSessionState(state)) {
    return "chase";
  }
  return isUnattendedReviewState(state) ? "review" : "notice";
};
