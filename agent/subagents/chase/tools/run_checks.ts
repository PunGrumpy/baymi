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
  rewriteReason,
  rewrote,
  tail,
  parseNameStatus,
} from "#lib/chase/checks";
import { stopResult } from "#lib/chase/report";
import { chaseState, endChase, recordRun } from "#lib/chase/state";
import {
  decodeListing,
  REPO_DIR,
  TREE_COMMAND,
  treeDiffCommand,
  treeId,
} from "#lib/chase/workspace";
import { releaseSandbox } from "#lib/sandbox";

/**
 * Installs dependencies and runs the project's own checks, and records the
 * result where the model cannot edit it.
 *
 * @remarks
 * The commands come from `#lib/chase/checks`, not from the model. The first
 * run is the reproduction, on the head as it is, and the record says whether
 * it failed. Every later run is an attempt. The record holds the tree before
 * the run (B, the clean checkout plus the model's own edits) and the tree
 * after it (C). The install is frozen, so a stale lockfile fails rather than
 * being rewritten; and if C differs from B, the install or a check rewrote a
 * tracked or non-ignored file, which is not the model's change and not what
 * the checks passed on. The chase then ends, naming the paths, rather than
 * pushing them or asking the model to decide. Each command is bounded by
 * what is left of the sandbox budget.
 */
export default defineTool({
  description:
    "Install dependencies with lifecycle scripts off and run the project's typecheck, check, lint and test scripts. " +
    "Call it once before any edit to reproduce the failure, and again after each fix, always in a step of its own and never alongside an edit. It reports each check's exit code and the end of its output.",
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
    // B: the clean checkout plus whatever the model has edited so far.
    const treeBefore = treeId(await sandbox.run({ command: TREE_COMMAND }));
    const results: CheckResult[] = [
      await run("install", installCommand(state.packageManager, timeout)),
    ];
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
    // C: what the install and the checks left. A tree that could not be
    // measured is recorded empty, which no push accepts.
    const changeDigest = treeId(await sandbox.run({ command: TREE_COMMAND }));
    const record = { changeDigest, results, treeBefore };
    chaseState.update((current) => recordRun(current, record));
    if (rewrote(record)) {
      const diff = treeDiffCommand(treeBefore, changeDigest);
      const listed =
        diff === null ? null : await sandbox.run({ command: diff });
      const paths =
        listed === null || listed.exitCode !== 0
          ? []
          : parseNameStatus(decodeListing(listed.stdout)).map(
              (change) => change.path
            );
      const result = stopResult({
        budgetSpent: false,
        reason: rewriteReason(paths),
        state: chaseState.get(),
      });
      chaseState.update((current) => endChase(current, result));
      await releaseSandbox(() => ctx.getSandbox());
      return { ran: results, result };
    }
    const runsLeft = MAX_CHECK_RUNS - state.checkRuns - 1;
    // The first run is the reproduction, and the model is told whether it saw the failure.
    return state.baseline === null
      ? { ran: results, reproduced: reproduced(record), runsLeft }
      : { ran: results, runsLeft };
  },
  inputSchema: z.object({}),
});
