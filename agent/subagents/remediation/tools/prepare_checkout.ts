import { defineTool } from "eve/tools";
import { z } from "zod";

import { mintInstallationToken } from "#lib/github/credentials";
import { REPOSITORY_PATTERN } from "#lib/github/dependencies";
import { listInstalledRepositories } from "#lib/github/installation";
import { downloadArchive } from "#lib/remediation/archive";
import {
  checkCommands,
  detectPackageManager,
  readScripts,
} from "#lib/remediation/checks";
import { remediationState } from "#lib/remediation/state";
import { isTask, resolveTask } from "#lib/remediation/task";
import {
  ARCHIVE_PATH,
  BASELINE_COMMAND,
  REPO_DIR,
  ROOT_FILES_COMMAND,
  UNPACK_COMMAND,
} from "#lib/remediation/workspace";
import { mayRemediate } from "#lib/trust";

/**
 * Resolves the task from GitHub and unpacks the repository into the sandbox.
 *
 * @remarks
 * Runs in the app runtime with the installation token, which never enters
 * the sandbox: the runtime downloads the default branch's archive at the
 * commit the task names and writes the bytes in. The task goes into durable
 * state, which is what `submit_fix` pushes against, so the repository and
 * the base commit are fixed here and nothing the model reads later can move
 * them. One task per session.
 */
export default defineTool({
  description:
    "Start the fix: resolve the task from GitHub and unpack the repository's default branch at /workspace/repo. " +
    "Call it first, once, with the repository as owner/name and the package name.",
  async execute({ packageName, repository }, ctx) {
    if (!mayRemediate(ctx.session.auth.current)) {
      return { refused: "Only a person can start a remediation." };
    }
    if (remediationState.get().task !== null) {
      return { refused: "This session already has a task." };
    }
    const token = await mintInstallationToken();
    const installed = await listInstalledRepositories(token);
    const match = installed.find(
      (candidate) =>
        candidate.fullName.toLowerCase() === repository.toLowerCase()
    );
    if (match === undefined || match.archived) {
      return {
        refused: `${repository} is not an installed, active repository.`,
      };
    }
    const task = await resolveTask({
      packageName,
      repository: match.fullName,
      token,
    });
    if (!isTask(task)) {
      return { refused: task.reason };
    }
    const sandbox = await ctx.getSandbox();
    await sandbox.writeBinaryFile({
      content: await downloadArchive({
        repository: task.repository,
        sha: task.baseSha,
        token,
      }),
      path: ARCHIVE_PATH,
    });
    for (const command of [UNPACK_COMMAND, BASELINE_COMMAND]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- unpack, then commit the baseline
      const result = await sandbox.run({ command });
      if (result.exitCode !== 0) {
        return {
          refused: `Preparing the checkout failed: ${result.stderr.trim()}`,
        };
      }
    }
    const listing = await sandbox.run({ command: ROOT_FILES_COMMAND });
    const rootFiles = listing.stdout.split("\n").filter(Boolean);
    const packageManager = detectPackageManager(rootFiles);
    const manifest = await sandbox.readTextFile({
      path: `${REPO_DIR}/package.json`,
    });
    const scripts = readScripts(manifest);
    remediationState.update((state) => ({ ...state, packageManager, task }));
    return {
      checks:
        packageManager === null
          ? []
          : checkCommands(packageManager, scripts).map((check) => check.name),
      defaultBranch: task.defaultBranch,
      ecosystem: task.ecosystem,
      fixedVersion: task.fixedVersion,
      packageManager,
      vulnerable: task.vulnerable.map((entry) => ({
        advisories: entry.advisories.map((advisory) => ({
          firstPatchedVersion: advisory.firstPatchedVersion,
          ghsa: advisory.ghsa,
          severity: advisory.severity,
          summary: advisory.summary,
        })),
        version: entry.version,
      })),
      workspace: REPO_DIR,
    };
  },
  inputSchema: z.object({
    packageName: z.string().min(1).max(214),
    repository: z
      .string()
      .regex(REPOSITORY_PATTERN)
      .describe("The repository as owner/name."),
  }),
});
