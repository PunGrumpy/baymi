import type { SessionAuthContext } from "eve/context";

import { refusedResult } from "#lib/chase/result";
import type { ChaseResult } from "#lib/chase/result";
import { readCiTurn } from "#lib/github/ci/turn";
import { pullRequestFromAuth, pullRequestUrl } from "#lib/github/pull-requests";
import { classifyPrincipal } from "#lib/trust";
import type { TrustContext } from "#lib/trust";

/**
 * What ties a chase to the pull request it was handed: the session's auth,
 * which the signed webhook stamped and the model cannot edit.
 *
 * @remarks
 * `chase_pull_request` admits one pull request, and the subagent then works
 * on whatever its own tools say. Its `prepare_checkout` takes the repository,
 * the pull request and the head as arguments, so without this a model talked
 * into other values would move the chase to a pull request that never went
 * through the gate: no CI-turn anchoring, no author or draft rule, no
 * own-fix check, and a budget claim spent on another head. The child session
 * runs under the parent's auth, so the anchor the gate checked is the one
 * these tools check again.
 *
 * A turn with no pull request behind it admits no chase. A person's turn in
 * Slack names a pull request only in words the model may have read in
 * untrusted text, and there is no signed anchor to hold it to.
 */

/** A pull request at a head, as the gate or a tool names it. */
export interface ChaseTarget {
  /** The head the tool names, or `null` where none has been read yet (the gate). */
  readonly headSha: string | null;
  readonly pullRequest: number;
  /** `owner/repo`. */
  readonly repository: string;
}

export const APP_SCOPE =
  "The app chases only the pull request its CI turn is about, and only when the diff's own code failed.";

const sameRepository = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/**
 * Why `target` is not the pull request this session was handed, or `null`
 * when it is.
 *
 * @remarks
 * The anchor must be there and must be `target`, for every class. The app
 * additionally needs its CI turn to have classified the failure as the
 * diff's own code, and the head to be the one that turn saw. A person's turn
 * carries no head; the pull request must be open at the head the tool names,
 * which the caller checks against GitHub.
 */
export const bindingProblem = (
  auth: SessionAuthContext | null,
  target: ChaseTarget,
  context: TrustContext = {}
): string | null => {
  const byApp = classifyPrincipal(auth, context) === "app";
  const anchor = pullRequestFromAuth(auth);
  if (anchor === null) {
    return byApp
      ? APP_SCOPE
      : "This turn is not about a pull request, so there is nothing to hold a chase to. Ask for it on the pull request itself.";
  }
  if (
    anchor.number !== target.pullRequest ||
    !sameRepository(anchor.repository, target.repository)
  ) {
    return byApp
      ? APP_SCOPE
      : `This turn is about ${anchor.repository}#${anchor.number}, not ${target.repository}#${target.pullRequest}.`;
  }
  if (!byApp) {
    return null;
  }
  const turn = readCiTurn(auth);
  if (turn === null || turn.kind !== "own-code") {
    return APP_SCOPE;
  }
  return target.headSha !== null && target.headSha !== turn.headSha
    ? `The CI turn is about head ${turn.headSha.slice(0, 7)}, not ${target.headSha.slice(0, 7)}.`
    : null;
};

/**
 * The result that ends a chase pointed at a pull request it was not handed.
 * It names the pull request the session was handed when there is one, and
 * the one asked for otherwise.
 */
export const bindingRefusal = (
  auth: SessionAuthContext | null,
  target: ChaseTarget,
  reason: string
): ChaseResult => {
  const handed = pullRequestFromAuth(auth);
  return refusedResult({
    headSha: target.headSha ?? "",
    pullRequest:
      handed?.url ?? pullRequestUrl(target.repository, target.pullRequest),
    reason,
  });
};
