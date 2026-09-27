import { z } from "zod";

import type { CheckResult, GitHubRequest } from "#lib/github/checks";
import { COMMENT_MAX_LENGTH } from "#lib/github/review";

/**
 * The one timeline comment an unattended review keeps on a pull request,
 * edited in place on every push.
 *
 * @remarks
 * A push runs the review again, and each run used to post its summary as a
 * new comment, so a pull request pushed to ten times carried ten of them.
 * Now the first review posts the summary and every later one rewrites it:
 * the timeline holds the current state, and GitHub keeps the edit history.
 *
 * Only the summary can work this way. GitHub does not take new inline
 * comments on a review already submitted, so a push that raises a new
 * finding still submits a review of its own; its body is the headline and
 * nothing more.
 *
 * The comment is found by its marker and by its author, so a comment
 * someone else wrote with the marker in it is never taken for Baymi's.
 */

const SUMMARY_MARKER_PREFIX = "<!-- baymi:summary";

const SHORT_SHA_LENGTH = 7;

/** One page of `GET /issues/{number}/comments`, as much of it as is read. */
const ISSUE_COMMENTS = z.array(
  z.object({
    body: z.string().nullish(),
    id: z.number().int(),
    user: z.object({ login: z.string() }).nullish(),
  })
);

type IssueComment = z.infer<typeof ISSUE_COMMENTS>[number];

const COMMENTS_PER_PAGE = 100;

/** Enough for any pull request a person still reads the timeline of. */
const MAX_COMMENT_PAGES = 10;

const PART_SEPARATOR = "\n\n";

const TRUNCATION_NOTICE =
  "\n\n_Cut short: the summary was over GitHub's comment limit._";

/** The hidden marker at the end of the summary comment. */
export const summaryMarker = (headSha: string | null): string =>
  headSha === null
    ? `${SUMMARY_MARKER_PREFIX} -->`
    : `${SUMMARY_MARKER_PREFIX} sha=${headSha} -->`;

/**
 * The summary as posted: the text, the head it describes, and the marker.
 * The head is visible because an edited comment keeps its place in the
 * timeline, and without it a reader cannot tell a fresh summary from a stale
 * one.
 */
export const renderSummary = (text: string, headSha: string | null): string => {
  const footer = [
    headSha === null
      ? ""
      : `_Reviewed at \`${headSha.slice(0, SHORT_SHA_LENGTH)}\`._`,
    summaryMarker(headSha),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const room =
    COMMENT_MAX_LENGTH -
    footer.length -
    TRUNCATION_NOTICE.length -
    PART_SEPARATOR.length;
  const body =
    text.length > room
      ? `${text.slice(0, room)}${TRUNCATION_NOTICE}`
      : text.trim();
  return `${body}${PART_SEPARATOR}${footer}`;
};

/** The id of Baymi's summary comment among `comments`, the latest if several. */
export const findSummaryComment = (
  comments: readonly IssueComment[],
  botName: string
): number | null => {
  const login = `${botName}[bot]`.toLowerCase();
  let found: number | null = null;
  for (const comment of comments) {
    if (
      comment.user?.login.toLowerCase() === login &&
      comment.body?.includes(SUMMARY_MARKER_PREFIX) === true
    ) {
      found = comment.id;
    }
  }
  return found;
};

const listComments = async (
  request: GitHubRequest,
  issuePath: string
): Promise<IssueComment[]> => {
  const comments: IssueComment[] = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are read in order until one comes back short
    const { body } = await request({
      method: "GET",
      path: `${issuePath}/comments?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
    });
    const batch = ISSUE_COMMENTS.parse(body);
    comments.push(...batch);
    if (batch.length < COMMENTS_PER_PAGE) {
      break;
    }
  }
  return comments;
};

/** Edits the summary comment when there is one, and posts it when there is not. */
export const upsertSummary = async (input: {
  readonly body: string;
  readonly botName: string;
  readonly owner: string;
  readonly pullRequestNumber: number;
  readonly repo: string;
  readonly request: GitHubRequest;
}): Promise<CheckResult> => {
  const { body, botName, owner, pullRequestNumber, repo, request } = input;
  const issuePath = `/repos/${owner}/${repo}/issues/${pullRequestNumber}`;
  try {
    const existing = findSummaryComment(
      await listComments(request, issuePath),
      botName
    );
    await (existing === null
      ? request({
          body: { body },
          method: "POST",
          path: `${issuePath}/comments`,
        })
      : request({
          body: { body },
          method: "PATCH",
          path: `/repos/${owner}/${repo}/issues/comments/${existing}`,
        }));
    return { ok: true };
  } catch (error) {
    return { error: `summary not posted: ${String(error)}`, ok: false };
  }
};
