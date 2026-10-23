import { z } from "zod";

import { isFixed } from "#lib/chase/result";
import type { ChaseResult } from "#lib/chase/result";
import type { GitHubRequest } from "#lib/github/checks";
import { decideRerun, decideSpeak } from "#lib/github/ci/decide";
import type { SpeakReason } from "#lib/github/ci/decide";
import type { LineDelivery } from "#lib/github/ci/deliver";
import type { ChaseLedger } from "#lib/github/ci/ledger";
import { ciSlackMessage } from "#lib/github/ci/line";
import type { CiTurn } from "#lib/github/ci/turn";
import type { PullRequestRef } from "#lib/github/pull-requests";
import type { SlackMessagePayload } from "#lib/slack/notify";

/**
 * The end of a chase turn: look at GitHub, decide whether anyone needs to
 * hear, and say it once.
 *
 * @remarks
 * Nothing the model wrote reaches this. Whether the rerun happened is read
 * from the run's attempt on GitHub, which moves from 1 to 2 the moment GitHub
 * accepts a rerun, so a model that skipped the call, a guard that refused it
 * and a rerun that went through are told apart by the run itself. The line is
 * rendered from the facts the hook stamped (`./turn.ts`).
 */

const RUN_ATTEMPT = z.object({ run_attempt: z.number().int().positive() });

/** Whether the run is on a later attempt than the one that failed. */
export const rerunTriggered = async (
  request: GitHubRequest,
  target: {
    readonly owner: string;
    readonly repo: string;
    readonly turn: Pick<CiTurn, "attempt" | "runId">;
  }
): Promise<boolean> => {
  if (target.turn.runId === null) {
    return false;
  }
  try {
    const { body } = await request({
      method: "GET",
      path: `/repos/${target.owner}/${target.repo}/actions/runs/${target.turn.runId}`,
    });
    return RUN_ATTEMPT.parse(body).run_attempt > target.turn.attempt;
  } catch {
    return false;
  }
};

/** What the end of a turn came to, for the log. */
export type SettleOutcome =
  | {
      readonly delivered: boolean;
      readonly reason: SpeakReason;
      readonly said: true;
    }
  | { readonly reason: "duplicate"; readonly said: false }
  | { readonly reason: "quiet"; readonly said: false }
  | {
      /** The chase pushed a fix or opened one; the checks run again on their own. */
      readonly reason: "fixed";
      readonly said: false;
      readonly summary: string;
    };

export interface SettleDeps {
  readonly ledger: ChaseLedger;
  readonly request: GitHubRequest;
  /**
   * Posts the message to the maintainer under the chase's key, unless Slack
   * already holds a message with that key (`./deliver.ts`), and says which.
   */
  readonly send: (
    message: SlackMessagePayload,
    key: string
  ) => Promise<LineDelivery>;
}

/** The free text after the headline: why the chase stopped, or the log line. */
const evidenceFor = (
  reason: SpeakReason,
  turn: CiTurn,
  chase: ChaseResult | null
): string | null => {
  if (reason === "chase-failed" && chase !== null) {
    return chase.reason;
  }
  return turn.evidence === "" ? null : turn.evidence;
};

/** Decides and, when someone needs to hear, sends the one line. */
export const settleChase = async (
  deps: SettleDeps,
  input: {
    /** What the chase tool answered on this turn, or `null` when it was not called or its answer was lost. */
    readonly chase: ChaseResult | null;
    readonly owner: string;
    readonly pullRequest: PullRequestRef;
    /** Whether the turn saw its own rerun call succeed, which settles it without a read. */
    readonly rerunAccepted: boolean;
    readonly repo: string;
    readonly turn: CiTurn;
  }
): Promise<SettleOutcome> => {
  const { owner, pullRequest, repo, turn } = input;
  const rerun = decideRerun({
    attempt: turn.attempt,
    classification: { kind: turn.kind },
    conclusion: turn.conclusion,
  });
  const triggered =
    rerun.rerun &&
    (input.rerunAccepted ||
      (await rerunTriggered(deps.request, { owner, repo, turn })));
  const { chase } = input;
  const reason = decideSpeak({
    attempt: turn.attempt,
    chase,
    classification: { kind: turn.kind },
    rerun,
    rerunTriggered: triggered,
  });
  if (reason === null) {
    return chase !== null && isFixed(chase)
      ? { reason: "fixed", said: false, summary: chase.reason }
      : { reason: "quiet", said: false };
  }
  // The ledger catches a repeat on this instance; Slack's own history, one on any other.
  if (!deps.ledger.claimReport(turn.key)) {
    return { reason: "duplicate", said: false };
  }
  const delivery = await deps.send(
    ciSlackMessage({
      attempt: turn.attempt,
      evidence: evidenceFor(reason, turn, chase),
      failure: turn.reason,
      job: turn.job,
      pullRequest,
      reason,
    }),
    turn.key
  );
  if (delivery.status === "duplicate") {
    return { reason: "duplicate", said: false };
  }
  return { delivered: delivery.status === "delivered", reason, said: true };
};
