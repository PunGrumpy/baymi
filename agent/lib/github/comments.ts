import type { GitHubComment } from "eve/channels/github";

import { isTrustedGitHubAssociation } from "#lib/trust";

/**
 * The GitHub App's slug, which is the handle people mention to reach the agent
 * and the stem of its login, `baymiai[bot]`. That login is what the
 * self-comment guard below compares against.
 *
 * @remarks
 * Deliberately not the agent's name. It calls itself Baymi everywhere, but
 * `baymi` was already registered as a GitHub App, so on GitHub alone it answers
 * to `@baymiai`. `agent/instructions.md` tells the model about the split; this
 * constant is the only place the code knows it.
 */
export const BOT_NAME = "baymiai";

/** Characters that carry meaning in a regex and must be escaped in a literal. */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/gu;

/**
 * Matches an `@baymiai` mention on a word boundary, the same pattern the
 * channel's built-in comment gate uses. Derived from the bot name so a rename
 * cannot leave the two out of sync.
 */
export const mentionPattern = (botName: string): RegExp =>
  new RegExp(
    `@${botName.replace(REGEX_METACHARACTERS, "\\$&")}(?=$|[^A-Za-z0-9_-])`,
    "iu"
  );

const MENTION_PATTERN = mentionPattern(BOT_NAME);

/**
 * Replicates the channel's built-in ignore rules: eve's own marker comments,
 * bot authors, and the agent's own `baymi[bot]` login.
 */
export const isIgnoredComment = (
  comment: GitHubComment,
  botName: string = BOT_NAME
): boolean => {
  if (comment.body.includes("<!-- eve:github:")) {
    return true;
  }
  const { author } = comment;
  if (author === undefined) {
    return false;
  }
  return (
    author.type === "Bot" ||
    author.login.toLowerCase() === `${botName.toLowerCase()}[bot]`
  );
};

/**
 * Whether a comment should start a session: it is not one the channel would
 * ignore, it mentions the agent, and its author is trusted with the repo.
 */
export const shouldDispatchComment = (comment: GitHubComment): boolean =>
  !isIgnoredComment(comment) &&
  MENTION_PATTERN.test(comment.body) &&
  isTrustedGitHubAssociation(comment.raw.author_association);
