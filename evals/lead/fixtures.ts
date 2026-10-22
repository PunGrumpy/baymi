/**
 * What a digest turn would hand the model, for evals that cannot run the
 * schedule.
 *
 * @remarks
 * The digest classifies pull requests in code and the model only composes
 * the message from the result, so these evals test the composing: they pass
 * an already classified list and never ask the model to judge CI. The
 * repository and the numbers are made up, so nothing here can be mistaken
 * for a fact about a real repository.
 */

export interface DigestPullRequest {
  readonly note: string;
  readonly title: string;
  readonly url: string;
}

const pullRequest = (
  repository: string,
  number: number,
  title: string,
  note: string
): DigestPullRequest => ({
  note,
  title,
  url: `https://github.com/example-owner/${repository}/pull/${number}`,
});

/** Healthy pull requests: CI passing, nothing waiting on the owner. */
export const HEALTHY: readonly DigestPullRequest[] = [
  pullRequest("web", 41, "feat(nav): collapsible sidebar", "CI passing"),
  pullRequest(
    "web",
    44,
    "chore(release): Version Packages",
    "release bot, CI passing"
  ),
  pullRequest("api", 90, "fix(auth): refresh tokens on 401", "CI passing"),
  pullRequest("docs", 12, "docs: explain the retry policy", "CI passing"),
];

/** A pull request that is green and waiting on the owner's merge. */
export const WAITING: DigestPullRequest = pullRequest(
  "api",
  88,
  "feat(billing): proration on plan changes",
  "CI passing, approved, waiting on PunGrumpy to merge"
);

const lines = (items: readonly DigestPullRequest[]): string =>
  items.length === 0
    ? "none"
    : items
        .map(({ note, title, url }) => `\n- ${url} ${title}. ${note}.`)
        .join("");

/**
 * The message a scheduled digest turn would carry: the classified list and
 * the instruction to compose from it.
 */
export const digestTurn = (
  needsOwner: readonly DigestPullRequest[],
  healthy: readonly DigestPullRequest[]
): string =>
  [
    "Scheduled turn: the weekday morning digest for Friday 2026-10-23.",
    "",
    "The open pull requests are already fetched and classified. Write the digest from this list, as the engineering-lead skill describes it. Do not look anything up and do not change a classification.",
    "",
    `Needs PunGrumpy: ${lines(needsOwner)}`,
    "Blocked: none",
    `Healthy (${healthy.length}): ${lines(healthy)}`,
  ].join("\n");

const PULL_REQUEST_LINK =
  /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/gu;

/** Every pull request link in the reply, in the order it appears. */
export const pullRequestLinks = (message: string): readonly string[] =>
  message.match(PULL_REQUEST_LINK) ?? [];

const PULL_REQUEST_NUMBER = /#(?<hash>\d+)|\/pull\/(?<path>\d+)/gu;

/**
 * The numbers of the pull requests the reply names, whether as a link, a
 * `repo/pull/41` path, or `#41`, so a shortened form does not slip past a
 * check that only looks for full links.
 */
export const namedPullRequests = (message: string): readonly string[] =>
  [...message.matchAll(PULL_REQUEST_NUMBER)].map(
    (match) => match.groups?.hash ?? match.groups?.path ?? ""
  );

/** Whether the reply names any pull request. */
export const namesAPullRequest = (message: string): boolean =>
  namedPullRequests(message).length > 0;
