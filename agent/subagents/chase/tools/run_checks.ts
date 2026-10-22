import { defineTool } from "eve/tools";
import { z } from "zod";

import { budgetLeftMs } from "#lib/chase/budget";
import type { CheckResult } from "#lib/chase/checks";
import {
  checkCommands,
  commandTimeout,
  installCommand,
  MAX_CHECK_RUNS,
  readScripts,
  reproduced,
  tail,
} from "#lib/chase/checks";
import { chaseState, recordRun } from "#lib/chase/state";
import { DIGEST_COMMAND, REPO_DIR } from "#lib/chase/workspace";

/**
 * Installs dependencies and runs the project's own checks, and records the
 * result where the model cannot edit it.
 *
 * @remarks
 * The commands come from `#lib/chase/checks`, not from the model. The first
 * run is the reproduction, on the head as it is, and the record says whether
 * it failed. Every later run is an attempt. The record holds a digest of the
 * change taken before the checks ran, so a check that rewrites files, or an
 * edit after the run, shows up at push as a change the checks did not cover.
 * Each command is bounded by what is left of the sandbox budget.
 */
export default defineTool({
  description:
    "Install dependencies with lifecycle scripts off and run the project's typecheck, check, lint and test scripts. " +
    "Call it once before any edit to reproduce the failure, and again after each fix. It reports each check's exit code and the end of its output.",
  async execute(_input, ctx) {
    const state = chaseState.get();
    if (state.task === null || state.startedAt === null) {
      return { refused: "Call prepare_checkout first." };
    }
    if (state.result !== null) {
      return { refused: "The chase is over." };
    }
    if (state.checkRuns >= MAX_CHECK_RUNS) {
      return {
        refused: `The checks have run ${MAX_CHECK_RUNS} times, the most a chase allows. Call stop_chase.`,
      };
    }
    const left = budgetLeftMs(state.startedAt, Date.now());
    if (left <= 0) {
      return { refused: "The sandbox budget is spent. Call stop_chase." };
    }
    if (state.packageManager === null) {
      return {
        refused:
          "The project has no lockfile this sandbox has a toolchain for, so no check can run. Call stop_chase.",
      };
    }
    const timeout = commandTimeout(left / 1000);
    const sandbox = await ctx.getSandbox();
    const run = async (name: string, command: string): Promise<CheckResult> => {
      const result = await sandbox.run({ command, workingDirectory: REPO_DIR });
      return {
        exitCode: result.exitCode,
        name,
        output: tail(`${result.stdout}\n${result.stderr}`.trim()),
      };
    };
    const results: CheckResult[] = [
      await run("install", installCommand(state.packageManager, timeout)),
    ];
    // The digest is taken after the install, which may rewrite the lockfile,
    // and before the checks, which must not change anything that is pushed.
    const digestRun = await sandbox.run({ command: DIGEST_COMMAND });
    if (results[0]?.exitCode === 0) {
      const scripts = readScripts(
        await sandbox.readTextFile({ path: `${REPO_DIR}/package.json` })
      );
      for (const check of checkCommands(
        state.packageManager,
        scripts,
        timeout
      )) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- checks run in order
        results.push(await run(check.name, check.command));
      }
    }
    // A digest that could not be taken is recorded empty, which no push accepts.
    const record = {
      changeDigest: digestRun.exitCode === 0 ? digestRun.stdout.trim() : "",
      results,
    };
    chaseState.update((current) => recordRun(current, record));
    const runsLeft = MAX_CHECK_RUNS - state.checkRuns - 1;
    // The first run is the reproduction, and the model is told whether it saw the failure.
    return state.baseline === null
      ? { ran: results, reproduced: reproduced(record), runsLeft }
      : { ran: results, runsLeft };
  },
  inputSchema: z.object({}),
});
