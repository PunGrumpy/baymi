import { getToken } from "@vercel/connect";
import type { GitHubEventContext, GitHubJsonObject } from "eve/channels/github";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

import { env } from "#lib/env";
import { failureNotice, logFailure } from "#lib/failure";
import { anchorReview } from "#lib/github/anchors";
import type { DiffFile } from "#lib/github/anchors";
import { BOT_NAME, shouldDispatchComment } from "#lib/github/comments";
import { githubCredentials } from "#lib/github/credentials";
import {
  createGroundingLedger,
  mayPostReview,
  UNGROUNDED_REVIEW_CODE,
} from "#lib/github/grounding";
import {
  isUnattendedReviewState,
  pullRequestUrl,
  shouldReviewPullRequest,
} from "#lib/github/pull-requests";
import { parseReview, renderReview, splitComment } from "#lib/github/review";
import type { AnchoredReview } from "#lib/github/review";
import { checkInMessage, postSlackMessage } from "#lib/slack/notify";
import { isUnattended, REVIEWER_PRINCIPAL } from "#lib/trust";

/** Which turns of this runtime settled an action; see `#lib/github/grounding`. */
const grounding = createGroundingLedger();

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

/** GitHub pages this endpoint; the diff in context stops at 50 files anyway. */
const DIFF_FILES_PER_PAGE = 100;

/**
 * Settles the findings against the pull request's diff, so each one sits
 * on a line GitHub will take. When the diff cannot be read, every finding
 * that names a line is trusted as written and the rest go into the body.
 */
const anchorAgainstDiff = async (
  channel: GitHubEventContext,
  review: NonNullable<ReturnType<typeof parseReview>>,
  pullRequestNumber: number
): Promise<AnchoredReview> => {
  const { owner, repo } = channel.state;
  try {
    const { body } = await channel.github.request<readonly DiffFile[]>({
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls/${pullRequestNumber}/files?per_page=${DIFF_FILES_PER_PAGE}`,
    });
    return anchorReview(review, body);
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
 * The findings are anchored against the diff first (`#lib/github/anchors`),
 * because the model computes line numbers by hand from hunk headers and a
 * wrong one would fail the whole review. GitHub still answers 422 for a
 * line it will not take, and one badly placed finding must not lose the
 * review, so any failure falls back to an ordinary comment.
 */
const postReply = async (
  channel: GitHubEventContext,
  message: string
): Promise<void> => {
  const { headSha, owner, pullRequestNumber, repo } = channel.state;
  const parsed = pullRequestNumber === null ? null : parseReview(message);
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
 * - An unattended review is posted only if its turn ran the tool loop.
 *   `action.result` and the reply's own `stepIndex` each attest to that,
 *   and `#lib/github/grounding` explains why. A turn whose tool calls never
 *   reached the runtime has read neither the skill nor the checkout, so it
 *   must not post a verdict on the pull request. It takes the same route as
 *   a review that died: nothing on the pull request, one card in Slack.
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
      if (
        !mayPostReview({
          grounded: grounding.isGrounded(event.turnId),
          step: event.stepIndex,
          unattended: isUnattended(ctx.session.auth.current),
        })
      ) {
        if (grounding.reportOnce(event.turnId)) {
          const failure = { code: UNGROUNDED_REVIEW_CODE };
          logFailure("review", {
            ...failure,
            message: "the turn answered without settling a single action",
          });
          await reportFailedReview(channel, failure);
        }
        return;
      }
      await postReply(channel, event.message);
    },
    async "session.failed"(event, channel) {
      logFailure("session", event);
      if (isUnattendedReviewState(channel.state)) {
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
  onPullRequest: (ctx, pullRequest) =>
    shouldReviewPullRequest(pullRequest, ctx.sender, BOT_NAME)
      ? {
          auth: {
            ...defaultGitHubAuth(ctx),
            principalId: REVIEWER_PRINCIPAL,
            principalType: "service",
          },
          title: `Security review: ${ctx.repository.fullName}#${pullRequest.pullRequestNumber}`,
        }
      : null,
});
