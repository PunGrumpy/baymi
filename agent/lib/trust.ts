import type { GitHubComment } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

/**
 * Who is allowed to drive the agent, expressed once.
 *
 * @remarks
 * Every channel answers "should this caller be able to start a session and
 * reach the write tools?" and each one answers it differently: GitHub has
 * `author_association`, Slack has workspace membership. Keeping the answers
 * here means a change to the trust model is one edit, testable without a
 * channel.
 *
 * Three kinds of caller exist. A trusted human, who can ask for anything the
 * approval layer allows. The unattended reviewer, a constructed principal
 * that reads a pull request nobody asked it to read and may do nothing but
 * reply. And everyone else, whose messages are acknowledged without a turn.
 */

/**
 * Commenter roles allowed to start a session by mentioning the agent on
 * GitHub.
 *
 * @remarks
 * GitHub's `author_association` on the comment payload. Anything outside this
 * set (CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, NONE, MANNEQUIN) is a
 * user the repository has not trusted with write access, so their mentions
 * are acknowledged without dispatching. On a public repository this is what
 * stops an arbitrary account from driving the agent's tools.
 */
const TRUSTED_GITHUB_ASSOCIATIONS = [
  "COLLABORATOR",
  "MEMBER",
  "OWNER",
] as const;

const TRUSTED_ASSOCIATION = z.enum(TRUSTED_GITHUB_ASSOCIATIONS);

/**
 * `author_association` as it actually arrives: a field of an untyped JSON
 * payload, which can hold any JSON value or be absent entirely.
 */
export type RawAuthorAssociation =
  | GitHubComment["raw"]["author_association"]
  | undefined;

/**
 * Whether a GitHub `author_association` marks its author as trusted with the
 * repository. Anything that is not one of the trusted strings, including a
 * missing or non-string value, is untrusted.
 */
export const isTrustedGitHubAssociation = (
  association?: RawAuthorAssociation
): boolean => TRUSTED_ASSOCIATION.safeParse(association).success;

/**
 * The principal an unattended pull request review runs as.
 *
 * @remarks
 * A turn started by a stranger's pull request must not run as that stranger,
 * and must not run as anyone the agent trusts either. It gets a constructed
 * identity of its own, which every gate in the codebase can recognize and
 * refuse. Real GitHub actors always have a numeric `github:<id>`, so a
 * login-shaped value here cannot collide with one.
 */
export const REVIEWER_PRINCIPAL = "github:baymiai";

/**
 * Whether this turn is an unattended review of a pull request.
 *
 * @remarks
 * Nobody asked for this turn and nobody is watching it, and the text that
 * started it came from whoever opened the pull request. Capabilities that
 * reach past the reply check this and withhold themselves: every GitHub write,
 * memory, and anything that could park the session on a question.
 */
export const isUnattended = (auth: SessionAuthContext | null): boolean =>
  auth !== null && auth.principalId === REVIEWER_PRINCIPAL;

/**
 * Whether this caller is a person in the agent's own Slack workspace.
 *
 * @remarks
 * eve mints `slack:<team>:<member>` for humans and `slack:<team>:bot:<id>`
 * for bots, and the workspace is private: only the maintainer can install
 * the app or invite into it, so the workspace is the allowlist. `teamId`
 * pins it further when set, which is what keeps a Slack Connect guest from
 * another workspace out; without it any human the connector delivers is in.
 */
export const isSlackHuman = (
  auth: SessionAuthContext | null,
  teamId?: string
): boolean =>
  auth !== null &&
  auth.authenticator === "slack-webhook" &&
  auth.principalType === "user" &&
  (teamId === undefined || auth.principalId.startsWith(`slack:${teamId}:`));
