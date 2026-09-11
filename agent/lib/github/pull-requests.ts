import type { GitHubPullRequestEvent, GitHubUser } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

import { isBotLogin } from "#lib/github/comments";

/**
 * The pull request actions that start an unattended review.
 *
 * @remarks
 * `opened` for a pull request that arrives ready, and `ready_for_review` for
 * one that arrives as a draft and is later marked ready. `synchronize` is
 * out on purpose: a review on every push is a review on every typo fix, and
 * the maintainer can ask for another look by mentioning the agent. Drafts
 * are skipped for the same reason, since the author has said the work is
 * not ready to be read.
 */
const REVIEWED_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "ready_for_review",
]);

/** The one field of the raw `pull_request` payload the dispatch reads. */
const RAW_PULL_REQUEST = z.looseObject({
  pull_request: z.looseObject({ draft: z.boolean().optional() }).optional(),
});

/**
 * Whether a pull request event should start an unattended security review.
 *
 * @remarks
 * Every pull request opened on a repository the App is installed on
 * qualifies, whoever opened it: the maintainer's own included, because a
 * second reader is the purpose. Bots are the exception. Dependency
 * bumps arrive by the dozen and their diff is a lockfile, and the agent's
 * own account is excluded so it can never review itself into a loop.
 */
export const shouldReviewPullRequest = (
  pullRequest: Pick<GitHubPullRequestEvent, "action" | "raw">,
  sender: Pick<GitHubUser, "login" | "type">,
  botName: string
): boolean => {
  if (!REVIEWED_ACTIONS.has(pullRequest.action)) {
    return false;
  }
  if (sender.type === "Bot" || isBotLogin(sender.login, botName)) {
    return false;
  }
  const raw = RAW_PULL_REQUEST.safeParse(pullRequest.raw);
  return !(raw.success && raw.data.pull_request?.draft === true);
};

/**
 * Whether this GitHub session is an unattended review, judged from channel
 * state rather than from who is calling.
 *
 * @remarks
 * `session.failed` runs outside session context and receives no auth, so
 * `isUnattended` is unavailable exactly where it matters most. The shape of
 * the state answers instead: a review is the only dispatch that starts from
 * a pull request event rather than from a comment, so it is the only one
 * anchored to a pull request with no triggering comment behind it.
 */
export const isUnattendedReviewState = (state: {
  readonly pullRequestNumber: number | null;
  readonly reviewCommentId: number | null;
  readonly triggeringCommentId: number | null;
}): boolean =>
  state.pullRequestNumber !== null &&
  state.triggeringCommentId === null &&
  state.reviewCommentId === null;

/**
 * The two attributes `defaultGitHubAuth` stamps that name a pull request.
 * The number arrives as a string, and an issue session leaves it empty.
 */
const PULL_REQUEST_ANCHOR = z.object({
  pull_request_number: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number),
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/u),
});

/** The pull request a session is anchored to. */
export interface PullRequestRef {
  readonly number: number;
  /** `owner/repo`. */
  readonly repository: string;
  readonly url: string;
}

/** Where a pull request lives on GitHub. */
export const pullRequestUrl = (repository: string, number: number): string =>
  `https://github.com/${repository}/pull/${number}`;

/**
 * The pull request a GitHub session was started on, read off the auth the
 * channel minted for it rather than off anything the model wrote.
 *
 * @remarks
 * `defaultGitHubAuth` copies the repository and pull request number into
 * `attributes` at dispatch, from the signed webhook. The diff under review
 * cannot change them, which is why the check-in tool takes no target as
 * input.
 */
export const pullRequestFromAuth = (
  auth: SessionAuthContext | null
): PullRequestRef | null => {
  const anchor = PULL_REQUEST_ANCHOR.safeParse(auth?.attributes);
  if (!anchor.success) {
    return null;
  }
  const { pull_request_number: number, repository } = anchor.data;
  return { number, repository, url: pullRequestUrl(repository, number) };
};
