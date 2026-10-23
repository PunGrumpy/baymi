import { z } from "zod";

import type { GitHubRequest } from "#lib/github/checks";

/**
 * Whether the pull request a red check names is one to chase.
 *
 * @remarks
 * The event says which pull request and which commit; only GitHub says
 * whether that pull request is still open, is a draft, who opened it, and
 * what its head is now. A check that finished on a commit the pull request
 * has moved past describes code nobody will merge, and the push that moved it
 * has its own checks coming.
 *
 * "The maintainer's" is the repository's owner: this agent is installed on
 * one person's account, and `ownsRepository` in `#lib/trust` reads it the
 * same way. A bot's pull request qualifies too (release pull requests,
 * dependency bumps, the agent's own), since the App is only installed where
 * the maintainer put it. A stranger's pull request does not: the chase would
 * read their branch's logs and spend a rerun on it.
 */

const PULL_REQUEST = z.object({
  base: z.object({ ref: z.string() }).optional(),
  draft: z.boolean().default(false),
  head: z.object({ sha: z.string() }),
  state: z.string(),
  title: z.string().default(""),
  user: z.object({ login: z.string(), type: z.string() }),
});

/** The fields of `GET /pulls/{number}` the chase reads. */
export type PullRequestFacts = z.infer<typeof PULL_REQUEST>;

export type PullRequestSkip =
  | "closed"
  | "draft"
  | "head-moved"
  | "not-the-maintainers";

/** `null` when the pull request is one to chase. */
export const skipPullRequest = (
  pullRequest: Pick<PullRequestFacts, "draft" | "head" | "state" | "user">,
  event: { readonly headSha: string },
  repositoryOwner: string
): PullRequestSkip | null => {
  if (pullRequest.state !== "open") {
    return "closed";
  }
  if (pullRequest.draft) {
    return "draft";
  }
  if (pullRequest.head.sha !== event.headSha) {
    return "head-moved";
  }
  const byOwner =
    pullRequest.user.login.toLowerCase() === repositoryOwner.toLowerCase();
  return byOwner || pullRequest.user.type === "Bot"
    ? null
    : "not-the-maintainers";
};

/** Reads and parses the pull request; throws if GitHub or the shape is wrong. */
export const readPullRequest = async (
  request: GitHubRequest,
  target: {
    readonly owner: string;
    readonly pullRequest: number;
    readonly repo: string;
  }
): Promise<PullRequestFacts> => {
  const { body } = await request({
    method: "GET",
    path: `/repos/${target.owner}/${target.repo}/pulls/${target.pullRequest}`,
  });
  return PULL_REQUEST.parse(body);
};
