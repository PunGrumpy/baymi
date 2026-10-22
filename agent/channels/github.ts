import { getToken } from "@vercel/connect";
import type {
  GitHubChannelState,
  GitHubEventContext,
  GitHubHandle,
  GitHubJsonObject,
} from "eve/channels/github";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import type { SessionAuthContext, SessionContext } from "eve/context";

import { env } from "#lib/env";
import { failureNotice, logFailure } from "#lib/failure";
import { anchorReview, DIFF_FILES } from "#lib/github/anchors";
import type {
  CheckOutcome,
  CheckResult,
  CheckTarget,
  GitHubRequest,
} from "#lib/github/checks";
import {
  currentHeadSha,
  failedOutcome,
  openCheckRun,
  reviewOutcome,
  settleCheckRun,
} from "#lib/github/checks";
import { sendLineOnce } from "#lib/github/ci/deliver";
import type { LineDelivery } from "#lib/github/ci/deliver";
import { startChase } from "#lib/github/ci/dispatch";
import type { ChaseDeps } from "#lib/github/ci/dispatch";
import {
  createChaseLedger,
  createChaseResultRecord,
  createRerunRecord,
} from "#lib/github/ci/ledger";
import { chaseFailedMessage } from "#lib/github/ci/line";
import { logChase } from "#lib/github/ci/log";
import { questionRoute, renderQuestions } from "#lib/github/ci/question";
import {
  clearFailedTurn,
  markFailedTurn,
  replyRoute,
  routeCompletedMessage,
  sessionFailureRoute,
  turnFailureRoute,
} from "#lib/github/ci/route";
import { withChaseSessions } from "#lib/github/ci/session";
import { settleChase } from "#lib/github/ci/settle";
import type { SettleOutcome } from "#lib/github/ci/settle";
import { readCiTurn } from "#lib/github/ci/turn";
import { BOT_NAME, shouldDispatchComment } from "#lib/github/comments";
import { githubCredentials } from "#lib/github/credentials";
import {
  createGroundingLedger,
  isReviewReply,
  mayPostReview,
  NOT_A_REVIEW_CODE,
  UNGROUNDED_REVIEW_CODE,
} from "#lib/github/grounding";
import type { TurnKey } from "#lib/github/grounding";
import {
  followUpContext,
  pullRequestFromAuth,
  pullRequestUrl,
  shouldReviewPullRequest,
} from "#lib/github/pull-requests";
import { parseReview, renderReview, splitComment } from "#lib/github/review";
import type { AnchoredReview, ParsedReview } from "#lib/github/review";
import { renderSummary, upsertSummary } from "#lib/github/summary";
import { releaseSandbox } from "#lib/sandbox";
import { checkInMessage, postSlackMessage } from "#lib/slack/notify";
import type { SlackMessagePayload } from "#lib/slack/notify";
import { isApp, isReviewer, REVIEWER_PRINCIPAL } from "#lib/trust";

/** Which turns of this runtime settled an action; see `#lib/github/grounding`. */
const grounding = createGroundingLedger();

const turnKey = (ctx: SessionContext, turnId: string): TurnKey => ({
  sessionId: ctx.session.id,
  turnId,
});

/** Which red checks this runtime already started a turn for, and already said something about. */
const chases = createChaseLedger();

/** Which chases saw their rerun call succeed; see `#lib/github/ci/ledger`. */
const reruns = createRerunRecord();

/** What each turn's chase tool answered; see `#lib/github/ci/ledger`. */
const chaseResults = createChaseResultRecord();

/** A refused row must never take the review with it; the permission can go away. */
const announce = (result: CheckResult): void => {
  if (!result.ok) {
    logFailure("review", { message: result.error });
  }
};

const checkTarget = (
  state: Pick<GitHubChannelState, "headSha" | "owner" | "repo">
): CheckTarget | null =>
  state.headSha === null
    ? null
    : { headSha: state.headSha, owner: state.owner, repo: state.repo };

const asRequest =
  (github: GitHubHandle): GitHubRequest =>
  (input) =>
    github.request(input);

/**
 * Points `channel.state.headSha` at the pull request's head as it is now, so
 * the check run, the review's `commit_id` and the summary all name the commit
 * the push brought rather than the session's first one.
 */
const refreshHeadSha = async (channel: GitHubEventContext): Promise<void> => {
  const { owner, pullRequestNumber, repo } = channel.state;
  if (pullRequestNumber === null) {
    return;
  }
  const headSha = await currentHeadSha({
    owner,
    pullRequestNumber,
    repo,
    request: asRequest(channel.github),
  });
  if (headSha !== null) {
    channel.state.headSha = headSha;
  }
};

/** Only an unattended review reaches here: nothing else opened a row. */
const settleCheck = async (
  channel: GitHubEventContext,
  outcome: CheckOutcome
): Promise<void> => {
  const target = checkTarget(channel.state);
  if (target === null) {
    return;
  }
  announce(
    await settleCheckRun({
      outcome,
      request: asRequest(channel.github),
      target,
    })
  );
};

/**
 * Tells the maintainer on Slack that a review died, and posts nothing on the
 * pull request.
 *
 * @remarks
 * Nobody asked for the review, so its failure goes to the maintainer rather
 * than to the author. Silence on the pull request would read as a clean
 * review, which is worse than an error, so the Slack card is what carries
 * it when a target is configured.
 *
 * Only `session.failed` calls this. A dead review emits `turn.failed` and
 * then `session.failed`, and a session can also fail with no turn failure
 * at all, so `session.failed` is the one event that always fires. Calling
 * this from both sent the card twice in production.
 */
const reportFailedReview = async (
  channel: GitHubEventContext,
  event: { readonly code?: string }
): Promise<void> => {
  const { headSha, owner, pullRequestNumber, repo } = channel.state;
  if (pullRequestNumber === null || env.SLACK_NOTIFY_CHANNEL === undefined) {
    return;
  }
  const repository = `${owner}/${repo}`;
  const message = checkInMessage({
    event: { code: event.code, kind: "review-failed" },
    headSha,
    now: new Date(),
    pullRequest: {
      number: pullRequestNumber,
      repository,
      url: pullRequestUrl(repository, pullRequestNumber),
    },
  });
  try {
    const token = await getToken(env.SLACK_CONNECTOR, {
      subject: { type: "app" },
    });
    const delivery = await postSlackMessage({
      message,
      target: env.SLACK_NOTIFY_CHANNEL,
      token,
    });
    if (!delivery.ok) {
      logFailure("notice", { message: delivery.error });
    }
  } catch (error) {
    logFailure("notice", { message: String(error) });
  }
};

/**
 * Sends the maintainer one Slack line from a turn nobody is watching, once
 * across every instance (`#lib/github/ci/deliver`), and says what became of
 * it. The line is logged first, so a deployment with no target configured
 * still leaves a trace of what it would have said.
 */
const tellMaintainer = async (
  message: SlackMessagePayload,
  key: string
): Promise<LineDelivery> => {
  logChase(`ci line: ${message.text}`);
  const target = env.SLACK_NOTIFY_CHANNEL;
  if (target === undefined) {
    logChase("ci line not sent: SLACK_NOTIFY_CHANNEL is not set");
    return { error: "SLACK_NOTIFY_CHANNEL is not set", status: "unsent" };
  }
  try {
    const token = await getToken(env.SLACK_CONNECTOR, {
      subject: { type: "app" },
    });
    const delivery = await sendLineOnce({
      key,
      now: new Date(),
      target,
      text: message.text,
      token,
    });
    if (delivery.status === "unsent") {
      logFailure("notice", { message: delivery.error });
    }
    return delivery;
  } catch (error) {
    logFailure("notice", { message: String(error) });
    return { error: String(error), status: "unsent" };
  }
};

/** The log's account of how a turn ended. */
const describeSettled = (outcome: SettleOutcome): string => {
  if (outcome.said) {
    return `said ${outcome.reason}, delivered=${outcome.delivered}`;
  }
  return outcome.reason === "fixed"
    ? `fixed, CI rerunning (${outcome.summary})`
    : outcome.reason;
};

/**
 * The end of an app turn on this channel: Slack, and never the pull request.
 *
 * @remarks
 * Nothing the turn wrote is posted. What the maintainer hears is decided from
 * the facts the hook stamped on the turn's auth and from what GitHub shows
 * now (`#lib/github/ci/settle`). An app turn that carries no such facts is
 * not one this channel started, and says nothing.
 */
const settleChaseTurn = async (
  channel: GitHubEventContext,
  ctx: SessionContext
): Promise<void> => {
  const auth = ctx.session.auth.current;
  const turn = readCiTurn(auth);
  const pullRequest = pullRequestFromAuth(auth);
  if (turn === null || pullRequest === null) {
    logChase("ci turn ended with no chase facts; nothing sent");
    return;
  }
  const { owner, repo } = channel.state;
  const outcome = await settleChase(
    {
      ledger: chases,
      request: asRequest(channel.github),
      send: tellMaintainer,
    },
    {
      chase: chaseResults.result(turn.key),
      owner,
      pullRequest,
      repo,
      rerunAccepted: reruns.accepted(turn.key),
      turn,
    }
  );
  logChase(`ci settled ${turn.key}: ${describeSettled(outcome)}`);
};

/**
 * A chase turn that died, said on Slack while its auth still names the chase.
 * The pull request hears nothing: `session.failed` reads the mark
 * `turn.failed` left and stays quiet.
 */
const reportFailedChaseTurn = async (
  auth: SessionAuthContext | null,
  event: { readonly code?: string }
): Promise<void> => {
  const turn = readCiTurn(auth);
  const pullRequest = pullRequestFromAuth(auth);
  if (turn === null || pullRequest === null) {
    logChase("ci turn failed with no chase facts; nothing sent");
    return;
  }
  const key = `failed:${turn.key}`;
  if (!chases.claimReport(key)) {
    return;
  }
  await tellMaintainer(
    chaseFailedMessage({ code: event.code, pullRequest }),
    key
  );
};

/** A chase session that died with no turn failure behind it: nothing else would say so. */
const reportFailedChase = async (
  channel: GitHubEventContext,
  event: { readonly code?: string; readonly sessionId: string }
): Promise<void> => {
  const { owner, pullRequestNumber, repo } = channel.state;
  if (pullRequestNumber === null) {
    return;
  }
  const repository = `${owner}/${repo}`;
  // The session is the chase's own, so its id names the chase.
  const key = `failed:${event.sessionId}`;
  if (!chases.claimReport(key)) {
    return;
  }
  await tellMaintainer(
    chaseFailedMessage({
      code: event.code,
      pullRequest: {
        number: pullRequestNumber,
        repository,
        url: pullRequestUrl(repository, pullRequestNumber),
      },
    }),
    key
  );
};

/** What the chase hooks need from the inbound context. */
const chaseDeps = (ctx: { readonly github: GitHubHandle }): ChaseDeps => ({
  ledger: chases,
  log: logChase,
  request: asRequest(ctx.github),
});

/** One page; the diff in context stops at 50 files anyway. */
const DIFF_FILES_PER_PAGE = 100;

/** Why a completed message must not be posted, or `null` when it may. */
const whyToHoldBack = (input: {
  readonly grounded: boolean;
  readonly parsed: boolean;
  readonly step: number;
  readonly unattended: boolean;
}): { readonly code: string; readonly message: string } | null => {
  if (!mayPostReview(input)) {
    return {
      code: UNGROUNDED_REVIEW_CODE,
      message: "the turn answered without reading anything",
    };
  }
  if (!isReviewReply({ parsed: input.parsed, unattended: input.unattended })) {
    return {
      code: NOT_A_REVIEW_CODE,
      message: "the turn answered with something that is not a review",
    };
  }
  return null;
};

/** When the diff cannot be read, findings with a line are trusted as written. */
const anchorAgainstDiff = async (
  channel: GitHubEventContext,
  review: ParsedReview,
  pullRequestNumber: number
): Promise<AnchoredReview> => {
  const { owner, repo } = channel.state;
  try {
    const { body } = await channel.github.request({
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/files?per_page=${DIFF_FILES_PER_PAGE}`,
    });
    return anchorReview(review, DIFF_FILES.parse(body));
  } catch (error) {
    logFailure("review", { message: `diff not read: ${String(error)}` });
    return {
      body: review.body,
      findings: review.findings.flatMap((finding) =>
        finding.line === null ? [] : [{ ...finding, line: finding.line }]
      ),
    };
  }
};

/**
 * Submits `review` as one `POST /pulls/{number}/reviews` with a fixed
 * `event: COMMENT`, so the verdict never comes from the model. Answers
 * whether GitHub took it: it answers 422 for a line it will not take, and one
 * badly placed finding must not lose the review, so the caller falls back.
 */
const submitReview = async (
  channel: GitHubEventContext,
  review: AnchoredReview,
  pullRequestNumber: number
): Promise<boolean> => {
  const { headSha, owner, repo } = channel.state;
  const rendered = renderReview(review, headSha);
  const comments = rendered.comments.map((comment) => ({ ...comment }));
  const body: GitHubJsonObject =
    headSha === null
      ? { body: rendered.body, comments, event: "COMMENT" }
      : { body: rendered.body, comments, commit_id: headSha, event: "COMMENT" };
  try {
    await channel.github.request({
      body,
      method: "POST",
      path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/reviews`,
    });
    return true;
  } catch (error) {
    logFailure("review", { message: String(error) });
    return false;
  }
};

const postComment = async (
  channel: GitHubEventContext,
  message: string
): Promise<void> => {
  for (const chunk of splitComment(message)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- chunks are posted in order
    await channel.thread.post(chunk);
  }
};

/**
 * Posts an unattended review: the inline findings as a review, and the rest
 * in the summary comment, which every later push edits instead of posting
 * again (`#lib/github/summary`).
 *
 * @remarks
 * The review's body is the headline alone, since the summary carries the
 * findings the diff could not place. A review GitHub rejects puts the whole
 * reply in the summary instead, so no finding is lost; a summary that cannot
 * be written falls back to a new comment.
 */
const postUnattendedReview = async (
  channel: GitHubEventContext,
  message: string,
  parsed: ParsedReview,
  pullRequestNumber: number
): Promise<void> => {
  const { headSha, owner, repo } = channel.state;
  const review = await anchorAgainstDiff(channel, parsed, pullRequestNumber);
  const submitted =
    review.findings.length > 0 &&
    (await submitReview(
      channel,
      { ...review, body: review.body.split("\n")[0] ?? "" },
      pullRequestNumber
    ));
  const summary = submitted ? review.body : message;
  const posted = await upsertSummary({
    body: renderSummary(summary, headSha),
    botName: BOT_NAME,
    owner,
    pullRequestNumber,
    repo,
    request: asRequest(channel.github),
  });
  if (!posted.ok) {
    logFailure("review", { message: posted.error });
    await postComment(channel, summary);
  }
};

/**
 * Posts the turn's reply: as a GitHub review with inline comments when the
 * reply is one, as a timeline comment otherwise.
 *
 * @remarks
 * Replaces eve's built-in handler, which posts every reply as a comment. An
 * unattended review goes through `postUnattendedReview`; a review someone
 * asked for in a mention is posted whole, as the answer to that mention.
 */
const postReply = async (
  channel: GitHubEventContext,
  message: string,
  parsed: ParsedReview | null,
  reviewing: boolean
): Promise<void> => {
  const { pullRequestNumber } = channel.state;
  if (parsed === null || pullRequestNumber === null) {
    await postComment(channel, message);
    return;
  }
  if (reviewing) {
    await postUnattendedReview(channel, message, parsed, pullRequestNumber);
    return;
  }
  const review = await anchorAgainstDiff(channel, parsed, pullRequestNumber);
  const submitted =
    review.findings.length > 0 &&
    (await submitReview(channel, review, pullRequestNumber));
  if (!submitted) {
    await postComment(channel, message);
  }
};

/**
 * Posts a turn's final reply, or holds it back and reports why.
 */
const settleReply = async (
  channel: GitHubEventContext,
  ctx: SessionContext,
  reply: {
    readonly message: string;
    readonly step: number;
    readonly turnId: string;
  }
): Promise<void> => {
  const reviewing = isReviewer(ctx.session.auth.current);
  const parsed = parseReview(reply.message);
  const holdBack = whyToHoldBack({
    grounded: grounding.isGrounded(turnKey(ctx, reply.turnId)),
    parsed: parsed !== null,
    step: reply.step,
    unattended: reviewing,
  });
  if (holdBack !== null) {
    if (grounding.reportOnce(turnKey(ctx, reply.turnId))) {
      logFailure("review", holdBack);
      await settleCheck(channel, failedOutcome(holdBack.code));
      await reportFailedReview(channel, { code: holdBack.code });
    }
    return;
  }
  await postReply(channel, reply.message, parsed, reviewing);
  if (reviewing && parsed !== null) {
    await settleCheck(channel, reviewOutcome(parsed));
  }
};

/**
 * GitHub channel: a security review of every pull request opened on a
 * repository the App is installed on, again on every push to it, and
 * answers to `@baymiai` mentions from people the repository trusts.
 *
 * @remarks
 * - `onPullRequest` starts the unattended review, and a follow-up on every
 *   push, in the same session as the first. The session runs under the
 *   constructed reviewer principal rather than as the author, so every gate
 *   in `agent/lib/` can recognize it: writes are refused, memory is off, and
 *   the reply is the only output it may produce. The diff arrives in context
 *   and eve checks the head commit out into the sandbox before the
 *   first model call.
 * - `onComment` replaces the built-in mention gate with
 *   `shouldDispatchComment`, which keeps the mention and ignore rules and
 *   adds the trust check: only an owner, member, or collaborator starts a
 *   session. Mentions from anyone else are acknowledged without one.
 * - Every reply on this channel is the turn's own completed message, which
 *   `postReply` submits as a review when it is one and posts as a comment
 *   otherwise. The agent never calls a comment tool to answer where it
 *   already is. An unattended review keeps one summary comment on the pull
 *   request and edits it on every push rather than posting another.
 * - An unattended review is posted only if its turn read something and
 *   wrote a review (`#lib/github/grounding`). Otherwise it takes the route
 *   of a review that died: nothing on the pull request, one card in Slack.
 * - A check run opens on the head commit at dispatch and settles when the
 *   review does, so the pull request says a review is running, and says so
 *   when one never arrived. It is opened here rather than from a
 *   `turn.started` handler, which would replace the built-in that checks the
 *   repository out. The row never gates: findings settle `neutral`.
 * - A question a turn asks is posted as a comment for a person, and dropped
 *   for the app (`#lib/github/ci/question`), replacing eve's built-in, which
 *   would post the app's question on the pull request.
 * - Failures on an attended turn are posted as a short notice with an error
 *   code; failures on a review go to Slack instead (see above).
 * - A message that arrives while a turn runs waits for it (`turnPolicy:
 *   "queue"`) rather than steering into it, which would hand the running
 *   turn the newcomer's auth: a mention during a review would take the
 *   review's reply. Queued messages fold into one turn when their auth is
 *   the same, so a burst of pushes is still one follow-up review.
 * - A CI turn runs as the app in a session of its own, in task mode
 *   (`#lib/github/ci/session`): it is offered no question, cannot park, and
 *   shares no turn, state or history with the review or a mention.
 * - After a turn posts its reply, the channel deletes the turn's sandbox
 *   (`#lib/sandbox`). eve checks the repository out again at the start of
 *   every turn, so no later turn reads the deleted one. On Hobby, an idle
 *   sandbox uses the monthly memory quota and its snapshot uses the lifetime
 *   storage quota.
 */
const pullRequestChannel = githubChannel({
  botName: BOT_NAME,
  credentials: githubCredentials,
  events: {
    "action.result"(event, _channel, ctx) {
      // A chase reads and acts to fix CI, which says nothing about a review.
      if (!isApp(ctx.session.auth.current)) {
        grounding.note(turnKey(ctx, event.turnId), event.result);
      }
      if (event.result.kind === "tool-result") {
        const outcome = {
          callId: event.result.callId,
          isError: event.result.isError,
          output: event.result.output,
          status: event.status,
          toolName: event.result.toolName,
        };
        reruns.settled(ctx.session.id, outcome);
        const turn = readCiTurn(ctx.session.auth.current);
        if (turn !== null) {
          chaseResults.note(turn.key, outcome);
        }
      }
    },
    "actions.requested"(event, _channel, ctx) {
      const turn = readCiTurn(ctx.session.auth.current);
      for (const action of event.actions) {
        if (action.kind === "tool-call") {
          reruns.requested(ctx.session.id, action, turn);
        }
      }
    },
    async "input.requested"(event, channel, ctx) {
      if (questionRoute(ctx.session.auth.current) === "drop") {
        // A chase is in task mode, which cannot wait for an answer: the turn
        // fails right after this, and turn.failed tells Slack.
        logChase(
          `ci turn asked ${event.requests.length} question(s) on turn ${event.turnId}; nothing posted`
        );
        return;
      }
      const prompt = renderQuestions(event.requests, BOT_NAME);
      if (prompt !== null) {
        await postComment(channel, prompt);
      }
    },
    async "message.completed"(event, channel, ctx) {
      if (event.finishReason === "tool-calls" || !event.message) {
        return;
      }
      try {
        // The app never takes the reply path: it posts to the pull request.
        // Its turn is settled at `turn.completed`, whether or not it said anything.
        await routeCompletedMessage({
          auth: ctx.session.auth.current,
          chase: () => Promise.resolve(),
          message: {
            message: event.message,
            step: event.stepIndex,
            turnId: event.turnId,
          },
          reply: async (reply) => {
            await refreshHeadSha(channel);
            await settleReply(channel, ctx, reply);
          },
        });
      } finally {
        const released = await releaseSandbox(() => ctx.getSandbox());
        if (!released.ok) {
          logFailure("sandbox", { message: released.error });
        }
      }
    },
    async "session.failed"(event, channel) {
      logFailure("session", event);
      const route = sessionFailureRoute(channel.state);
      if (route === "quiet") {
        // The app's turn died, and turn.failed told Slack. Neither the
        // session's notice nor the review's check run is the app's to write.
        return;
      }
      if (route === "chase") {
        await reportFailedChase(channel, event);
        return;
      }
      if (route === "review") {
        await refreshHeadSha(channel);
        await settleCheck(channel, failedOutcome(event.code));
        await reportFailedReview(channel, event);
        return;
      }
      await channel.thread.post(
        failureNotice(
          "This session could not recover from an error",
          "Send a new mention in this thread to start a fresh one.",
          event
        )
      );
    },
    async "turn.completed"(event, channel, ctx) {
      clearFailedTurn(channel.state);
      if (replyRoute(ctx.session.auth.current) === "chase") {
        await settleChaseTurn(channel, ctx);
      }
    },
    async "turn.failed"(event, channel, ctx) {
      logFailure("turn", event);
      const auth = ctx.session.auth.current;
      markFailedTurn(channel.state, auth);
      const route = turnFailureRoute(auth);
      if (route === "chase") {
        await reportFailedChaseTurn(auth, event);
        return;
      }
      if (route === "quiet") {
        // The review's session fails next and says it once, on Slack
        // (reportFailedReview).
        return;
      }
      await channel.thread.post(
        failureNotice(
          "I hit an error working on this",
          "Mention me again in this thread and I'll retry.",
          event
        )
      );
    },
  },
  onCheckRun: (ctx, checkRun) =>
    startChase(
      {
        authBase: defaultGitHubAuth(ctx),
        ci: { kind: "check_run", payload: checkRun },
        owner: ctx.repository.owner,
        repo: ctx.repository.name,
      },
      chaseDeps(ctx)
    ),
  onComment: (ctx, comment) =>
    shouldDispatchComment(comment) ? { auth: defaultGitHubAuth(ctx) } : null,
  async onPullRequest(ctx, pullRequest) {
    if (!shouldReviewPullRequest(pullRequest, ctx.sender, BOT_NAME)) {
      return null;
    }
    if (pullRequest.headSha !== null) {
      announce(
        await openCheckRun({
          request: asRequest(ctx.github),
          target: {
            headSha: pullRequest.headSha,
            owner: ctx.repository.owner,
            repo: ctx.repository.name,
          },
        })
      );
    }
    return {
      auth: {
        ...defaultGitHubAuth(ctx),
        principalId: REVIEWER_PRINCIPAL,
        principalType: "service",
      },
      context: followUpContext(pullRequest),
      title: `Security review: ${ctx.repository.fullName}#${pullRequest.pullRequestNumber}`,
    };
  },
  onWorkflowRun: (ctx, workflowRun) =>
    startChase(
      {
        authBase: defaultGitHubAuth(ctx),
        ci: { kind: "workflow_run", payload: workflowRun },
        owner: ctx.repository.owner,
        repo: ctx.repository.name,
      },
      chaseDeps(ctx)
    ),
  turnPolicy: "queue",
});

export default withChaseSessions(pullRequestChannel);
