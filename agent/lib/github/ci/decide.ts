import type { Classification } from "#lib/github/ci/classify";
import { RERUNNABLE_CONCLUSIONS } from "#lib/github/rerun";

/**
 * What to do about a classified failure, and whether anyone needs to hear.
 *
 * @remarks
 * Two decisions, kept apart because they are made at different times. Whether
 * to rerun is known before the turn runs, from the classification and the
 * attempt. Whether to speak is known after it, because it depends on whether
 * the rerun happened, and that is read back from GitHub rather than taken
 * from the model's word (`./settle.ts`).
 *
 * The rerun rule is the guard's (`#lib/github/rerun`) seen from above: a
 * flake on the first attempt is rerun once and nothing else ever is. The
 * guard remains the thing that makes the write safe; this only decides
 * whether to ask.
 */

/** The first attempt is the only one rerun. */
const FIRST_ATTEMPT = 1;

export type RerunDecision =
  | { readonly rerun: true }
  | {
      readonly reason: "already-rerun" | "not-a-flake" | "not-rerunnable";
      readonly rerun: false;
    };

export const decideRerun = (input: {
  readonly attempt: number;
  readonly classification: Pick<Classification, "kind">;
  readonly conclusion: string;
}): RerunDecision => {
  if (input.classification.kind !== "flake") {
    return { reason: "not-a-flake", rerun: false };
  }
  if (input.attempt > FIRST_ATTEMPT) {
    return { reason: "already-rerun", rerun: false };
  }
  if (
    !RERUNNABLE_CONCLUSIONS.some(
      (conclusion) => conclusion === input.conclusion
    )
  ) {
    return { reason: "not-rerunnable", rerun: false };
  }
  return { rerun: true };
};

/**
 * Why Slack is told, one per way a pull request ends up needing the
 * maintainer or an agent that is not there yet.
 *
 * - `own-code`: the diff's own code failed. Until the unit that fixes it
 *   exists nobody else can clear it.
 * - `stale-base`: the base fails the same job, so the fix is the base's,
 *   and the pull request picks it up on its next push.
 * - `second-failure`: it failed again after a rerun, so it was not a flake.
 * - `rerun-not-done`: a flake the guard or the turn did not rerun.
 * - `cannot-rerun`: a flake GitHub will not rerun (a timeout it reports as cancelled).
 * - `unclassified`: no log, or no file in it.
 * - `external-check`: an app's check that no agent can rerun or read.
 */
export type SpeakReason =
  | "cannot-rerun"
  | "external-check"
  | "own-code"
  | "rerun-not-done"
  | "second-failure"
  | "stale-base"
  | "unclassified";

/**
 * Whether a person is told, and why; `null` when the digest can carry it.
 *
 * @remarks
 * A rerun that GitHub accepted is the one silent outcome: the new attempt
 * either passes, and nothing happened, or fails, and the event for attempt 2
 * lands here as a `second-failure`.
 */
export const decideSpeak = (input: {
  readonly attempt: number;
  readonly classification: Pick<Classification, "kind">;
  readonly rerun: RerunDecision;
  /** Whether a rerun was observed on GitHub after the turn. */
  readonly rerunTriggered: boolean;
}): SpeakReason | null => {
  switch (input.classification.kind) {
    case "external": {
      return "external-check";
    }
    case "own-code": {
      return "own-code";
    }
    case "stale-base": {
      return "stale-base";
    }
    case "unknown": {
      return "unclassified";
    }
    default: {
      break;
    }
  }
  if (input.attempt > FIRST_ATTEMPT) {
    return "second-failure";
  }
  if (!input.rerun.rerun) {
    return "cannot-rerun";
  }
  return input.rerunTriggered ? null : "rerun-not-done";
};
