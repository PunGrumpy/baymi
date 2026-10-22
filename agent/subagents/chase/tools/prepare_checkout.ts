import { defineTool } from "eve/tools";
import { z } from "zod";

import { downloadArchive } from "#lib/chase/archive";
import { SANDBOX_BUDGET_MS } from "#lib/chase/budget";
import {
  checkCommands,
  detectPackageManager,
  readScripts,
} from "#lib/chase/checks";
import { githubSend } from "#lib/chase/commit";
import { chaseState } from "#lib/chase/state";
import {
  ARCHIVE_PATH,
  BASELINE_COMMAND,
  REPO_DIR,
  ROOT_FILES_COMMAND,
  UNPACK_COMMAND,
} from "#lib/chase/workspace";
import { env } from "#lib/env";
import { mintInstallationToken } from "#lib/github/credentials";
import { REPOSITORY_PATTERN } from "#lib/github/dependencies";
import { listInstalledRepositories } from "#lib/github/installation";
import { mayChase } from "#lib/trust";

const PULL = z.object({
  base: z.object({ repo: z.object({ full_name: z.string() }) }),
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
    sha: z.string(),
  }),
  html_url: z.string(),
  state: z.string(),
});

/**
 * Reads the pull request from GitHub and unpacks its head into the sandbox.
 *
 * @remarks
 * Runs in the app runtime with the installation token, which never enters
 * the sandbox: the runtime downloads the head commit's archive and writes
 * the bytes in. The pull request, its head and its branch go into durable
 * state, which is what `push_fix` pushes against, so they are fixed here and
 * nothing the model reads later can move them. It refuses a head that is not
 * the pull request's head now, so the chase works on the commit the `chase`
 * tool admitted. One checkout per session; the sandbox budget starts here.
 */
export default defineTool({
  description:
    "Start the chase: unpack the pull request's head at /workspace/repo. Call it first, once, with the repository, the pull request number and the head sha from your message.",
  async execute({ headSha, pullRequest, repository }, ctx) {
    if (
      !mayChase(ctx.session.auth.current, { slackTeamId: env.SLACK_TEAM_ID })
    ) {
      return { refused: "Only the app and the maintainer can start a chase." };
    }
    if (chaseState.get().task !== null) {
      return { refused: "This session already has a checkout." };
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
    const read = await githubSend(token)(
      `/repos/${match.fullName}/pulls/${pullRequest}`,
      { method: "GET" }
    );
    const pull = PULL.safeParse(read.body).data;
    if (read.status !== 200 || pull === undefined) {
      return {
        refused: `GitHub answered ${read.status} reading the pull request.`,
      };
    }
    if (pull.state !== "open" || pull.head.sha !== headSha) {
      return {
        refused: `The pull request is ${pull.state} at ${pull.head.sha.slice(0, 7)}, not open at ${headSha.slice(0, 7)}.`,
      };
    }
    const sandbox = await ctx.getSandbox();
    await sandbox.writeBinaryFile({
      content: await downloadArchive({
        repository: match.fullName,
        sha: headSha,
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
    const packageManager = detectPackageManager(
      listing.stdout.split("\n").filter(Boolean)
    );
    const scripts = readScripts(
      await sandbox.readTextFile({ path: `${REPO_DIR}/package.json` })
    );
    chaseState.update((state) => ({
      ...state,
      packageManager,
      startedAt: Date.now(),
      task: {
        headRef: pull.head.ref,
        headSha,
        pullRequest,
        repository: match.fullName,
        url: pull.html_url,
      },
    }));
    return {
      budgetMinutes: SANDBOX_BUDGET_MS / 60_000,
      checks:
        packageManager === null
          ? []
          : checkCommands(packageManager, scripts).map((check) => check.name),
      packageManager,
      workspace: REPO_DIR,
    };
  },
  inputSchema: z.object({
    headSha: z.string().regex(/^[0-9a-f]{40}$/u),
    pullRequest: z.number().int().positive(),
    repository: z
      .string()
      .regex(REPOSITORY_PATTERN)
      .describe("The repository as owner/name."),
  }),
});
