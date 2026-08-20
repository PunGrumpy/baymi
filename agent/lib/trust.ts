/**
 * Who is allowed to drive the agent, expressed once.
 *
 * @remarks
 * Every surface answers "should this caller be able to start a session and
 * reach the write tools?" and each one answers it differently: GitHub has
 * `author_association`, Slack has channel membership, Linear has the Agent
 * Session. Keeping the answers here rather than inside each channel means a
 * change to the trust model is one edit, and it can be tested without booting
 * a channel.
 */

/**
 * Commenter roles allowed to start a session by mentioning the agent on
 * GitHub.
 *
 * @remarks
 * GitHub's `author_association` on the comment payload. Anything outside this
 * set (CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, NONE, MANNEQUIN) is a
 * user the repo hasn't trusted with write access, so their mentions are
 * acknowledged without dispatching. On a public repo this is what stops an
 * arbitrary account from driving the agent's write tools.
 */
export const TRUSTED_GITHUB_ASSOCIATIONS: ReadonlySet<string> = new Set([
  "COLLABORATOR",
  "MEMBER",
  "OWNER",
]);

/**
 * Whether a GitHub `author_association` marks its author as trusted with the
 * repository. Anything that is not one of the trusted strings, including a
 * missing or non-string value, is untrusted.
 */
export const isTrustedGitHubAssociation = (association: unknown): boolean =>
  typeof association === "string" &&
  TRUSTED_GITHUB_ASSOCIATIONS.has(association);
