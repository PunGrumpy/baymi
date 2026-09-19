import { getToken } from "@vercel/connect";
import type {
  GitHubChannelState,
  GitHubEventContext,
  GitHubHandle,
  GitHubJsonObject,
} from "eve/channels/github";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

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
  failedOutcome,
  openCheckRun,
  reviewOutcome,
  settleCheckRun,
} from "#lib/github/checks";
import { BOT_NAME, shouldDispatchComment } from "#lib/github/comments";
import { githubCredentials } from "#lib/github/credentials";
import {
  createGroundingLedger,
  isReviewReply,
  mayPostReview,
  NOT_A_REVIEW_CODE,
  UNGROUNDED_REVIEW_CODE,
} from "#lib/github/grounding";
import {
  isUnattendedReviewState,
  pullRequestUrl,
  shouldReviewPullRequest,
} from "#lib/github/pull-requests";
import { parseReview, renderReview, splitComment } from "#lib/github/review";
import type { AnchoredReview, ParsedReview } from "#lib/github/review";
import { checkInMessage, postSlackMessage } from "#lib/slack/notify";
import { isUnattended, REVIEWER_PRINCIPAL } from "#lib/trust";

/** Which turns of this runtime settled an action; see `#lib/github/grounding`. */
const grounding = createGroundingLedger();

/**
 * The check row's verdict, or its absence, must never take the review with
 * it: the permission can be withheld, and a review that posted is worth more
 * than the row that describes it.
 */
const announce = (result: CheckResult): void => {
  if (!result.ok) {
    logFailure("review", { message: result.error });
  }
};

/** The head commit a check run hangs on, or `null` when there is none to use. */
const checkTarget = (
  state: Pick<GitHubChannelState, "headSha" | "owner" | "repo">
): CheckTarget | null =>
  state.headSha === null
    ? null
    : { headSha: state.headSha, owner: state.owner, repo: state.repo };

/** eve's handle as the one call `#lib/github/checks` asks for. */
const asRequest =
  (github: GitHubHandle): GitHubRequest =>
  (input) =>
    github.request(input);

/** Settles the row for an unattended review; attended turns have no row. */
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
 * Posts the turn's reply: as a GitHub review with inline comments when the
 * reply is one, as a timeline comment otherwise.
 *
 * @remarks
 * Replaces eve's built-in handler, which posts every reply as a comment. A
 * reply that parses as a review becomes one `POST /pulls/{number}/reviews`
 * with a fixed `event: COMMENT`, so the verdict never comes from the model.
 *
 * GitHub answers 422 for a line it will not take, and one badly placed
 * finding must not lose the review, so any failure falls back to an
 * ordinary comment.
 */
const postReply = async (
  channel: GitHubEventContext,
  message: string,
  parsed: ParsedReview | null
): Promise<void> => {
  const { headSha, owner, pullRequestNumber, repo } = channel.state;
  const review =
    parsed === null || pullRequestNumber === null
      ? null
      : await anchorAgainstDiff(channel, parsed, pullRequestNumber);
  if (review !== null && review.findings.length > 0) {
    const rendered = renderReview(review, headSha);
    const body: GitHubJsonObject =
      headSha === null
        ? {
            body: rendered.body,
            comments: rendered.comments.map((comment) => ({ ...comment })),
            event: "COMMENT",
          }
        : {
            body: rendered.body,
            comments: rendered.comments.map((comment) => ({ ...comment })),
            commit_id: headSha,
            event: "COMMENT",
          };
    try {
      await channel.github.request({
        body,
        method: "POST",
        path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/reviews`,
      });
      return;
    } catch (error) {
      logFailure("review", { message: String(error) });
    }
  }
  for (const chunk of splitComment(message)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- chunks are posted in order
    await channel.thread.post(chunk);
  }
};

/**
 * GitHub channel: a security review of every pull request opened on a
 * repository the App is installed on, and answers to `@baymiai` mentions
 * from people the repository trusts.
 *
 * @remarks
 * - `onPullRequest` starts the unattended review. The session runs under the
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
 *   already is.
 * - An unattended review is posted only if its turn read something and
 *   wrote a review (`#lib/github/grounding`). Otherwise it takes the route
 *   of a review that died: nothing on the pull request, one card in Slack.
 * - A check run opens on the head commit at dispatch and settles when the
 *   review does, so the pull request says a review is running, and says so
 *   when one never arrived. It is opened here rather than from a
 *   `turn.started` handler, which would replace the built-in that checks the
 *   repository out. The row never gates: findings settle `neutral`.
 * - Failures on an attended turn are posted as a short notice with an error
 *   code; failures on a review go to Slack instead (see above).
 */
export default githubChannel({
  botName: BOT_NAME,
  credentials: githubCredentials,
  events: {
    "action.result"(event) {
      grounding.note(event.turnId, event.result);
    },
    async "message.completed"(event, channel, ctx) {
      if (event.finishReason === "tool-calls" || !event.message) {
        return;
      }
      const unattended = isUnattended(ctx.session.auth.current);
      const parsed = parseReview(event.message);
      const holdBack = whyToHoldBack({
        grounded: grounding.isGrounded(event.turnId),
        parsed: parsed !== null,
        step: event.stepIndex,
        unattended,
      });
      if (holdBack !== null) {
        if (grounding.reportOnce(event.turnId)) {
          logFailure("review", holdBack);
          await settleCheck(channel, failedOutcome(holdBack.code));
          await reportFailedReview(channel, { code: holdBack.code });
        }
        return;
      }
      await postReply(channel, event.message, parsed);
      if (unattended && parsed !== null) {
        await settleCheck(channel, reviewOutcome(parsed));
      }
    },
    async "session.failed"(event, channel) {
      logFailure("session", event);
      if (isUnattendedReviewState(channel.state)) {
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
    async "turn.failed"(event, channel, ctx) {
      logFailure("turn", event);
      if (isUnattended(ctx.session.auth.current)) {
        // The session fails next and sends the one card; see reportFailedReview.
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
      title: `Security review: ${ctx.repository.fullName}#${pullRequest.pullRequestNumber}`,
    };
  },
});
