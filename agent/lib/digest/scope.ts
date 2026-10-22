/**
 * Which pull requests the morning digest covers, and which day it is for.
 *
 * @remarks
 * The scope is the one `CLAUDE.md` gives the engineering lead: repositories
 * the maintainer owns, open pull requests updated in the last thirty days,
 * drafts skipped. The owners are read back from the GitHub App's installation
 * (`listInstalledRepositories`) rather than configured, so the digest covers
 * exactly the repositories the agent can act on and nothing needs setting up.
 */

/** How far back an open pull request still counts as live. */
export const DIGEST_WINDOW_DAYS = 30;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_SECOND = 1000;

/** Bangkok is UTC+7 all year; Thailand has no daylight saving. */
const BANGKOK_OFFSET_MS = 7 * MS_PER_HOUR;

const DATE_LENGTH = "YYYY-MM-DD".length;

/** `YYYY-MM-DD` of the day `moment` falls on in Bangkok. */
export const bangkokDate = (moment: Date): string =>
  new Date(moment.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, DATE_LENGTH);

/**
 * Unix seconds of 00:00 in Bangkok on the day `moment` falls on there.
 *
 * @remarks
 * What a duplicate check reads Slack history from: every digest of one
 * Bangkok day was posted after this instant.
 */
export const bangkokDayStart = (moment: Date): number =>
  (Date.parse(`${bangkokDate(moment)}T00:00:00.000Z`) - BANGKOK_OFFSET_MS) /
  MS_PER_SECOND;

/** The first day, in Bangkok, on which an update still keeps a pull request in scope. */
export const windowStart = (now: Date): string =>
  bangkokDate(new Date(now.getTime() - DIGEST_WINDOW_DAYS * MS_PER_DAY));

/**
 * The GitHub search that finds the pull requests the digest is about.
 *
 * @remarks
 * `user:` bounds the search to repositories the owner owns, which keeps out
 * the public repositories a search token can otherwise read (`docs/notes.md`
 * on `searchIssues`). `draft:false` and `archived:false` are the scope's
 * "drafts skipped" and a repository nobody will merge into. The classifier
 * checks the draft flag again, since a search index can lag a conversion.
 */
export const digestQuery = (input: {
  readonly now: Date;
  readonly owners: readonly string[];
}): string =>
  [
    ...input.owners.map((owner) => `user:${owner}`),
    "is:pr",
    "is:open",
    "draft:false",
    "archived:false",
    `updated:>=${windowStart(input.now)}`,
  ].join(" ");

/** The distinct owners of a list of `owner/repo` names, in first-seen order. */
export const ownersOf = (fullNames: readonly string[]): readonly string[] => {
  const owners = new Set<string>();
  for (const fullName of fullNames) {
    const [owner] = fullName.split("/");
    if (owner) {
      owners.add(owner);
    }
  }
  return [...owners];
};
