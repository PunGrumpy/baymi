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
 * Every principal the agent can meet falls into one of five classes
 * (`TrustClass`), and `classifyPrincipal` is the only place that reads a
 * principal's id, type, or authenticator to decide which. Callers ask a
 * predicate or the class, never match a principal string themselves, so a
 * new kind of caller is a new class here and a compile error everywhere a
 * table over the classes is missing its row.
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
 * The principal eve gives a turn the app starts on its own: a schedule's
 * `appAuth`, and the principal a CI-event turn is dispatched as.
 *
 * @remarks
 * Measured on `eve dev` 0.62.0 (`docs/notes.md`): `{ authenticator: "app",
 * principalId: "eve:app", principalType: "runtime", attributes: {} }`, with
 * `auth.current` and `auth.initiator` both set to it. Only eve's own
 * dispatch mints it. No authenticator on the HTTP route produces the id, and
 * a Vercel OIDC token for this project arrives as `runtime` with a
 * `<issuer>:<subject>` id instead, which is why the class is keyed on the id
 * and the type together.
 */
export const APP_PRINCIPAL = "eve:app";

/**
 * Every kind of caller, closed: a new kind of caller is a new member here.
 *
 * - `maintainer`: the person the agent works for, attended. Asks for
 *   anything, answers approval cards, owns the memory.
 * - `collaborator`: another person the repository trusts with write access,
 *   attended, on a mention. Can ask, has no memory of their own to read.
 * - `reviewer`: the constructed principal reading a stranger's pull request.
 *   Unattended, may post its one reply and nothing else.
 * - `app`: the agent acting on its own clock or on a CI event. Unattended,
 *   reads the maintainer's memory but never writes it.
 * - `stranger`: anyone else, including no caller at all. Gets nothing.
 */
export const TRUST_CLASSES = [
  "maintainer",
  "collaborator",
  "reviewer",
  "app",
  "stranger",
] as const;

export type TrustClass = (typeof TRUST_CLASSES)[number];

/** What a class may do with the maintainer's memory slot. */
export type MemoryAccess = "none" | "read" | "write";

/**
 * Memory per class. `app` reads without writing because its turn reads
 * pull request titles and CI logs that strangers wrote: a log line that
 * could reach `file__save_memory` would instruct every later turn.
 * Exhaustive over `TrustClass`, so a new class cannot ship without a row.
 */
const MEMORY_ACCESS = {
  app: "read",
  collaborator: "none",
  maintainer: "write",
  reviewer: "none",
  stranger: "none",
} as const satisfies Record<TrustClass, MemoryAccess>;

/** The part of the environment that changes who counts as the maintainer. */
export interface TrustContext {
  /** `SLACK_TEAM_ID`: pins which workspace's humans are the maintainer. */
  readonly slackTeamId?: string | undefined;
}

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

/**
 * A person at the operator's own terminal or signed in to the Vercel team
 * that owns the deployment: the `[localDev(), vercelOidc()]` the HTTP route
 * accepts. Project-minted OIDC tokens are `service` or `runtime` and are not
 * a person.
 */
const isOperator = (auth: SessionAuthContext): boolean =>
  (auth.authenticator === "local-dev" && auth.principalType === "local-dev") ||
  (auth.authenticator === "oidc" && auth.principalType === "user");

/** A person delivered by the GitHub channel's signed webhook. */
const isGitHubHuman = (auth: SessionAuthContext): boolean =>
  auth.authenticator === "github-webhook" && auth.principalType === "user";

const LOGIN = z.string().min(1);

/**
 * Whether a GitHub person owns the repository the event came from.
 *
 * @remarks
 * `defaultGitHubAuth` sets `issuer` to `github:<repository owner>` and
 * `user_login` to the sender, both from the signed payload. On a personal
 * repository the owner is the maintainer; any other person who got through
 * the mention gate is a collaborator. On an organization's repository
 * nobody matches, so a deployment there has no GitHub maintainer and falls
 * back to no memory rather than to shared memory. Logins are not case
 * sensitive on GitHub.
 */
const ownsRepository = (auth: SessionAuthContext): boolean => {
  const login = LOGIN.safeParse(auth.attributes.user_login);
  return (
    login.success &&
    auth.issuer?.toLowerCase() === `github:${login.data}`.toLowerCase()
  );
};

/**
 * Which class this caller belongs to.
 *
 * @remarks
 * The reviewer and the app are recognized by the principal's id alone (and
 * type, for the app), ahead of anything derived from the sender, because the
 * reviewer principal is built on top of the pull request author's GitHub auth
 * and must never be read as that author. Everything unrecognized is a
 * stranger.
 */
export const classifyPrincipal = (
  auth: SessionAuthContext | null,
  context: TrustContext = {}
): TrustClass => {
  if (auth === null) {
    return "stranger";
  }
  if (auth.principalId === REVIEWER_PRINCIPAL) {
    return "reviewer";
  }
  if (auth.principalId === APP_PRINCIPAL && auth.principalType === "runtime") {
    return "app";
  }
  if (isSlackHuman(auth, context.slackTeamId) || isOperator(auth)) {
    return "maintainer";
  }
  if (isGitHubHuman(auth)) {
    return ownsRepository(auth) ? "maintainer" : "collaborator";
  }
  return "stranger";
};

/**
 * Whether this turn is an unattended review of a pull request.
 *
 * @remarks
 * For what only a review does: the review instructions, the one reply
 * posted as a pull request review, the check-in. The app is also unattended
 * but is not reviewing anything, so those take this and not `isUnattended`.
 */
export const isReviewer = (auth: SessionAuthContext | null): boolean =>
  classifyPrincipal(auth) === "reviewer";

/**
 * Whether this turn is the app acting on its own: a schedule or a CI event.
 */
export const isApp = (auth: SessionAuthContext | null): boolean =>
  classifyPrincipal(auth) === "app";

/**
 * Whether nobody is watching this turn: the reviewer or the app.
 *
 * @remarks
 * Nobody asked for the turn and nobody reads it as it runs, and the text it
 * reads came from whoever opened a pull request or wrote a log line.
 * Capabilities that reach past the reply check this and withhold themselves:
 * every GitHub write that needs a person's say-so, and anything that could
 * park the session on a question.
 */
export const isUnattended = (auth: SessionAuthContext | null): boolean => {
  const trustClass = classifyPrincipal(auth);
  return trustClass === "reviewer" || trustClass === "app";
};

/**
 * What this caller may do with the maintainer's memory slot.
 *
 * @remarks
 * `context` carries the Slack team pin so a human of another workspace is a
 * stranger here as well as at the channel.
 */
export const memoryAccess = (
  auth: SessionAuthContext | null,
  context: TrustContext = {}
): MemoryAccess => MEMORY_ACCESS[classifyPrincipal(auth, context)];

/**
 * Whether this turn may start a remediation: a person asked, in a session
 * that is not an unattended one.
 *
 * @remarks
 * Remediation opens a pull request with code the sandbox changed, so it is
 * the one capability that writes to a repository. A person has to have asked
 * for it on this turn. The channels admit only trusted people to a session
 * at all (`shouldDispatchComment`, `isSlackHuman`), and this keeps out the
 * constructed reviewer principal, the app, and any service caller on top of
 * that. A diff can never start one, because the review turn reading it has no
 * remediation tool to call.
 *
 * The app is refused today. It runs unattended on text strangers wrote, with
 * nobody to ask, so a remediation it started would open a pull request on a
 * log line's say-so. Opening it for a CI failure the app itself found is
 * unit C1's decision, and is a change to this predicate.
 */
export const mayRemediate = (auth: SessionAuthContext | null): boolean => {
  const trustClass = classifyPrincipal(auth);
  return trustClass === "maintainer" || trustClass === "collaborator";
};
