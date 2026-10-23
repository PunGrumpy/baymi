import { defineState } from "eve/context";

import type { CheckRecord, PackageManager } from "#lib/chase/checks";
import type { ChaseResult } from "#lib/chase/result";

/**
 * What a chase session knows that the model must not be able to change.
 *
 * @remarks
 * Durable session state lives in the app runtime. Code running in the
 * sandbox cannot reach it, and the model reaches it only through the tools
 * that write it. `prepare_checkout` writes the task and the clock,
 * `run_checks` writes the reproduction and the latest run, and `push_fix` and
 * `stop_chase` read them and write the result, so the pull request, the head,
 * the verdict and the outcome come from here rather than from tool
 * arguments.
 */

/** The pull request a session works on, fixed at checkout. */
export interface ChaseCheckout {
  readonly headRef: string;
  readonly headSha: string;
  readonly pullRequest: number;
  /** `owner/repo`. */
  readonly repository: string;
  readonly url: string;
}

export interface ChaseState {
  /** The first run, on the head as it was: the reproduction. */
  readonly baseline: CheckRecord | null;
  /** How many times `run_checks` ran; the first is the reproduction. */
  readonly checkRuns: number;
  /**
   * A: the tree id of the baseline commit, taken right after the clean
   * checkout; empty before one. Every change is measured against it.
   */
  readonly cleanTree: string;
  /** The latest run after the reproduction, or `null` before one. */
  readonly latest: CheckRecord | null;
  readonly packageManager: PackageManager | null;
  /** Set once the chase pushed or stopped, so nothing runs after it. */
  readonly result: ChaseResult | null;
  /** When the checkout was written: the sandbox budget counts from here. */
  readonly startedAt: number | null;
  readonly task: ChaseCheckout | null;
}

/** A session that has not checked anything out yet. */
export const initialChaseState = (): ChaseState => ({
  baseline: null,
  checkRuns: 0,
  cleanTree: "",
  latest: null,
  packageManager: null,
  result: null,
  startedAt: null,
  task: null,
});

/**
 * Ends the chase with `result`, unless it already ended: the first outcome
 * stands, so nothing that happens after it can rewrite what was reported.
 */
export const endChase = (state: ChaseState, result: ChaseResult): ChaseState =>
  state.result === null ? { ...state, result } : state;

/** Records one run of the checks: the first is the reproduction, every later one the latest. */
export const recordRun = (state: ChaseState, run: CheckRecord): ChaseState =>
  state.baseline === null
    ? { ...state, baseline: run, checkRuns: state.checkRuns + 1 }
    : { ...state, checkRuns: state.checkRuns + 1, latest: run };

export const chaseState = defineState("baymi.chase", initialChaseState);
