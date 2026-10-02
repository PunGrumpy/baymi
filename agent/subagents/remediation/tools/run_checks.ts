import { defineTool } from "eve/tools";
import { z } from "zod";

import type { CheckResult } from "#lib/remediation/checks";
import {
  CHECKABLE_ECOSYSTEMS,
  checkCommands,
  installCommand,
  MAX_CHECK_RUNS,
  readScripts,
  tail,
} from "#lib/remediation/checks";
import { remediationState } from "#lib/remediation/state";
import { DIGEST_COMMAND, REPO_DIR } from "#lib/remediation/workspace";

/**
 * Installs dependencies and runs the project's own checks, and records the
 * result where the model cannot edit it.
 *
 * @remarks
 * The commands come from `#lib/remediation/checks`, not from the model. The
 * record holds a digest of the change taken before the checks ran, so a
 * check that rewrites files, or an edit after the run, shows up at submit as
 * a change the checks did not cover. Each run counts against
 * `MAX_CHECK_RUNS`: the first after the bump and one per code-fix attempt.
 */
export default defineTool({
  description:
    "Install dependencies with lifecycle scripts off and run the project's typecheck, check, lint and test scripts. " +
    "Call it after the bump, and again after each code fix. It reports each check's exit code and the end of its output.",
  async execute(_input, ctx) {
    const state = remediationState.get();
    if (state.task === null) {
      return { refused: "Call prepare_checkout first." };
    }
    if (state.checkRuns >= MAX_CHECK_RUNS) {
      return {
        refused: `The checks have run ${MAX_CHECK_RUNS} times, the most this run allows. Submit what you have.`,
      };
    }
    if (
      state.packageManager === null ||
      !CHECKABLE_ECOSYSTEMS.has(state.task.ecosystem)
    ) {
      remediationState.update((current) => ({
        ...current,
        checkRuns: current.checkRuns + 1,
      }));
      return {
        ran: [],
        skipped:
          "The sandbox has no toolchain for this project, so no check can run.",
      };
    }
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
      await run("install", installCommand(state.packageManager)),
    ];
    // The digest is taken after the install, which may rewrite the lockfile,
    // and before the checks, which must not change anything that is pushed.
    const digestRun = await sandbox.run({ command: DIGEST_COMMAND });
    const digest = digestRun.stdout.trim();
    if (results[0]?.exitCode === 0) {
      const scripts = readScripts(
        await sandbox.readTextFile({ path: `${REPO_DIR}/package.json` })
      );
      for (const check of checkCommands(state.packageManager, scripts)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- checks run in order
        results.push(await run(check.name, check.command));
      }
    }
    remediationState.update((current) => ({
      ...current,
      checkRuns: current.checkRuns + 1,
      checks: { changeDigest: digest, results },
    }));
    return {
      ran: results,
      runsLeft: MAX_CHECK_RUNS - state.checkRuns - 1,
    };
  },
  inputSchema: z.object({}),
});
