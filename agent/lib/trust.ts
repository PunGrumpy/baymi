import type { SessionAuthContext } from "eve/context";

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

/**
 * The principal an unattended first-responder turn runs as.
 *
 * @remarks
 * A turn started by a stranger's issue must not run as that stranger, and must
 * not run as anyone the agent trusts either. It gets a constructed identity of
 * its own, which every gate in the codebase can recognize and refuse. Real
 * GitHub actors always carry a numeric `github:<id>`, so a login-shaped value
 * here cannot collide with one.
 */
export const AUTONOMOUS_GITHUB_PRINCIPAL = "github:baymiai";

/**
 * Whether this session is an unattended turn triaging a new issue.
 *
 * @remarks
 * Nobody asked for this turn and nobody is watching it, and the text that
 * started it came from someone the repository has not trusted with anything.
 * Capabilities that reach past the issue it is answering check this and
 * withhold themselves.
 */
export const isAutonomous = (auth: SessionAuthContext | null): boolean =>
  auth !== null && auth.principalId === AUTONOMOUS_GITHUB_PRINCIPAL;
