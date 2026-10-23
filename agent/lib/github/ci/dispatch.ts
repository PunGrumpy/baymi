import type {
  GitHubCheckRunEvent,
  GitHubInboundResult,
  GitHubWorkflowRunEvent,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";

import type { GitHubRequest } from "#lib/github/checks";
import { assessCiFailure } from "#lib/github/ci/assess";
import {
  isRedConclusion,
  readCheckRun,
  readWorkflowRun,
} from "#lib/github/ci/event";
import type { EventVerdict } from "#lib/github/ci/event";
import { ciKey } from "#lib/github/ci/ledger";
import type { ChaseLedger } from "#lib/github/ci/ledger";
import { readPullRequest, skipPullRequest } from "#lib/github/ci/pull-request";
import type { PullRequestFacts } from "#lib/github/ci/pull-request";
import { chaseAuth, chaseBrief, ciTurn } from "#lib/github/ci/turn";

/**
 * The hook side of the chase: from a webhook to the turn it starts, or to
 * nothing.
 *
 * @remarks
 * `onCheckRun` and `onWorkflowRun` both end here. The order is cheapest
 * first and writes nothing: the event's own rules, then the pull request, then
 * the claim on the key, then the reads that classify. A hook that throws is
 * swallowed by eve and logged, so the one read that can fail without losing
 * the chase (the log) fails soft inside `assessCiFailure`, and the ones that
 * must succeed (the pull request) are caught here and logged as a skip.
 */

export type CiInput =
  | { readonly kind: "check_run"; readonly payload: GitHubCheckRunEvent }
  | { readonly kind: "workflow_run"; readonly payload: GitHubWorkflowRunEvent };

export interface ChaseDeps {
  /** Where a skip is written, so a missing chase can be explained. */
  readonly log: (message: string) => void;
  readonly ledger: ChaseLedger;
  readonly request: GitHubRequest;
}

export interface ChaseSource {
  readonly authBase: SessionAuthContext;
  readonly ci: CiInput;
  readonly owner: string;
  readonly repo: string;
}

const verdictOf = (ci: CiInput): EventVerdict =>
  ci.kind === "workflow_run"
    ? readWorkflowRun(ci.payload)
    : readCheckRun(ci.payload);

/** The turn a red check starts, or `null` to start nothing. */
export const startChase = async (
  source: ChaseSource,
  deps: ChaseDeps
): Promise<GitHubInboundResult> => {
  const { owner, repo } = source;
  const where = `${owner}/${repo}`;
  const verdict = verdictOf(source.ci);
  if (!verdict.ok) {
    deps.log(`ci skip ${source.ci.kind} ${where}: ${verdict.skip}`);
    return null;
  }
  const { event } = verdict;
  let pullRequest: PullRequestFacts;
  try {
    pullRequest = await readPullRequest(deps.request, {
      owner,
      pullRequest: event.pullRequest,
      repo,
    });
  } catch (error) {
    deps.log(
      `ci skip ${where}#${event.pullRequest}: pull request unread (${String(error)})`
    );
    return null;
  }
  const skip = skipPullRequest(pullRequest, event, owner);
  if (skip !== null) {
    deps.log(`ci skip ${where}#${event.pullRequest}: ${skip}`);
    return null;
  }
  const key = ciKey({ owner, repo }, event);
  if (!deps.ledger.claimDispatch(key)) {
    deps.log(`ci skip ${where}#${event.pullRequest}: ${key} already chased`);
    return null;
  }
  const assessment = await assessCiFailure(deps.request, {
    event,
    owner,
    pullRequest,
    repo,
  });
  // The event can be older than the run: a rerun that passed, or one still going, is not a failure to chase.
  if (!isRedConclusion(assessment.conclusion)) {
    deps.log(
      `ci skip ${where}#${event.pullRequest}: run ${assessment.runId ?? "-"} is ${assessment.conclusion} now`
    );
    return null;
  }
  // A cancelled run is a timeout only when its log says so. Anything else was
  // stopped on purpose, by a person or a newer push, whatever else the log
  // printed: a network warning there does not make the cancel a flake.
  if (
    event.conclusion === "cancelled" &&
    assessment.classification.reason !== "timeout"
  ) {
    deps.log(
      `ci skip ${where}#${event.pullRequest}: cancelled by a person or a newer push, not a timeout`
    );
    return null;
  }
  const turn = ciTurn(assessment, key);
  return {
    auth: chaseAuth(source.authBase, turn),
    context: chaseBrief(turn),
    title: `CI chase: ${where}#${event.pullRequest} ${event.checkName}`,
  };
};
