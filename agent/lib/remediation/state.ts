import { defineState } from "eve/context";

import type { CheckRecord, PackageManager } from "#lib/remediation/checks";
import type { RemediationTask } from "#lib/remediation/task";

/**
 * What a remediation session knows that the model must not be able to
 * change.
 *
 * @remarks
 * Durable session state lives in the app runtime. Code running in the
 * sandbox cannot reach it, and the model reaches it only through the tools
 * that write it. `prepare_checkout` writes the task, `run_checks` writes the
 * check record, and `submit_fix` reads both, so the repository, the base
 * commit and the verdict come from here rather than from tool arguments.
 */
export interface RemediationState {
  /** How many times `run_checks` ran; the instructions allow a bounded number. */
  readonly checkRuns: number;
  readonly checks: CheckRecord | null;
  readonly packageManager: PackageManager | null;
  /** Set once the pull request is open, so a second submit is refused. */
  readonly pullRequestUrl: string | null;
  readonly task: RemediationTask | null;
}

/** A session that has not prepared a checkout yet. */
export const initialRemediationState = (): RemediationState => ({
  checkRuns: 0,
  checks: null,
  packageManager: null,
  pullRequestUrl: null,
  task: null,
});

export const remediationState = defineState(
  "baymi.remediation",
  initialRemediationState
);
