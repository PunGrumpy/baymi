import { reproduced, tail } from "#lib/chase/checks";
import type { CheckRecord } from "#lib/chase/checks";
import type { ChaseCheck, ChaseResult } from "#lib/chase/result";
import type { ChaseCheckout, ChaseState } from "#lib/chase/state";

/**
 * The words a chase leaves behind: the result when it stops without a push,
 * and the body of a pull request it opens instead of pushing.
 *
 * @remarks
 * Built from the recorded runs, never from what the model says passed. A
 * failure carries the end of the failing output, so the maintainer reading
 * the Slack line or the pull request does not have to rerun anything to see
 * what broke.
 */

/** How much failing output a result carries. */
const RESULT_OUTPUT_CHARACTERS = 1500;

/** A run's checks, as the result lists them. */
export const checksOf = (record: CheckRecord | null): readonly ChaseCheck[] =>
  (record?.results ?? []).map((result) => ({
    exitCode: result.exitCode,
    name: result.name,
    passed: result.exitCode === 0,
  }));

/** The end of every failing check's output in a run. */
export const failingOutput = (record: CheckRecord | null): string =>
  tail(
    (record?.results ?? [])
      .filter((result) => result.exitCode !== 0)
      .map(
        (result) =>
          `$ ${result.name} (exit ${result.exitCode})\n${result.output}`
      )
      .join("\n\n"),
    RESULT_OUTPUT_CHARACTERS
  );

/**
 * The result of a chase that stops without pushing.
 *
 * @remarks
 * Which kind of stop it was comes from the record: no run at all is a
 * failure, a first run that passed is a failure that did not reproduce, a
 * spent budget is partial, and anything else is a fix the checks did not
 * pass.
 */
export const stopResult = (input: {
  readonly budgetSpent: boolean;
  readonly reason: string;
  readonly state: ChaseState;
}): ChaseResult => {
  const { state } = input;
  const task: Pick<ChaseCheckout, "headSha" | "url"> = state.task ?? {
    headSha: "",
    url: "",
  };
  const last = state.latest ?? state.baseline;
  let status: ChaseResult["status"] = "failed";
  if (input.budgetSpent) {
    status = "partial";
  } else if (state.baseline !== null && !reproduced(state.baseline)) {
    status = "not-reproduced";
  }
  return {
    branch: null,
    checks: [...checksOf(last)],
    commits: [],
    fixPullRequest: null,
    headSha: task.headSha,
    notVerified: ["No fix was pushed."],
    output: failingOutput(last),
    pullRequest: task.url,
    reason: input.reason.trim() || "The chase stopped without a fix.",
    status,
  };
};

/** The body of a pull request the chase opens against a branch it may not push to. */
export const fixPullRequestBody = (input: {
  readonly baseline: CheckRecord | null;
  readonly latest: CheckRecord | null;
  readonly messages: readonly string[];
  readonly task: ChaseCheckout;
}): string => {
  const { task } = input;
  const checks = (record: CheckRecord | null) =>
    checksOf(record).map(
      (check) =>
        `- \`${check.name}\`: ${check.passed ? "passed" : `exited with ${check.exitCode}`}`
    );
  return [
    `Fixes the failing checks on ${task.url} at ${task.headSha.slice(0, 7)}. The head branch \`${task.headRef}\` could not be pushed to, so the fix is this pull request against it.`,
    "",
    "### Before",
    "",
    ...checks(input.baseline),
    "",
    "### After",
    "",
    ...checks(input.latest),
    "",
    "### Commits",
    "",
    ...input.messages.map((message) => `- ${message.split("\n")[0] ?? ""}`),
    "",
    "Lifecycle scripts were off during install.",
  ].join("\n");
};
