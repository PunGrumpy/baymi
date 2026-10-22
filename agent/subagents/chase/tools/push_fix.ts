import { Buffer } from "node:buffer";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { budgetLeftMs } from "#lib/chase/budget";
import { fixVerdict, parseNameStatus } from "#lib/chase/checks";
import type { ChangedPath } from "#lib/chase/checks";
import { githubSend } from "#lib/chase/commit";
import type { CommitFile, CommitPlan } from "#lib/chase/commit";
import { deliverFix, groupCommits } from "#lib/chase/deliver";
import { checksOf, fixPullRequestBody } from "#lib/chase/report";
import type { ChaseResult } from "#lib/chase/result";
import { chaseState } from "#lib/chase/state";
import {
  CHANGES_COMMAND,
  DIGEST_COMMAND,
  MODES_COMMAND,
  parseModes,
  REPO_DIR,
} from "#lib/chase/workspace";
import { mintInstallationToken } from "#lib/github/credentials";
import { releaseSandbox } from "#lib/sandbox";

/**
 * Pushes a verified fix as atomic commits, to the pull request's branch or
 * as a pull request against it.
 *
 * @remarks
 * The model names the commits: a message and the files for each. Everything
 * else comes from state and from GitHub. The verdict is the check record's,
 * compared with a digest of the change taken now, and an unverified change is
 * refused rather than pushed: it goes to `stop_chase` instead. Where the
 * commits go is decided at the push, from GitHub (`#lib/chase/deliver`). The
 * files come from the sandbox as bytes; the runtime pushes them through the
 * Git Data API with the installation token, which never enters the sandbox.
 * Once anything is pushed, or the head turns out to have moved, the sandbox
 * is deleted and the chase is over.
 */
export default defineTool({
  description:
    "Push your fix after run_checks passed on your last edit. Split it into atomic commits: for each, a Conventional Commits message whose body says what failed and what changed, and the files it holds. " +
    "Every changed file goes in exactly one commit. It answers with the result to report.",
  async execute({ commits }, ctx) {
    const state = chaseState.get();
    const { task } = state;
    if (task === null || state.startedAt === null) {
      return { refused: "Call prepare_checkout first." };
    }
    if (state.result !== null) {
      return { refused: "The chase is over.", result: state.result };
    }
    if (budgetLeftMs(state.startedAt, Date.now()) <= 0) {
      return { refused: "The sandbox budget is spent. Call stop_chase." };
    }
    const sandbox = await ctx.getSandbox();
    const listed = await sandbox.run({ command: CHANGES_COMMAND });
    const changes = parseNameStatus(listed.stdout);
    const grouping = groupCommits(changes, commits);
    if (!grouping.ok) {
      return { problems: grouping.problems, refused: "Nothing was pushed." };
    }
    const digest = await sandbox.run({ command: DIGEST_COMMAND });
    const verdict = fixVerdict({
      baseline: state.baseline,
      currentDigest: digest.stdout.trim(),
      latest: state.latest,
    });
    if (!verdict.verified) {
      return {
        reasons: verdict.reasons,
        refused:
          "The fix is not verified, so nothing was pushed. Run run_checks after your last edit, or call stop_chase.",
      };
    }
    const staged = await sandbox.run({ command: MODES_COMMAND });
    const modes = parseModes(staged.stdout);
    const read = async (change: ChangedPath): Promise<CommitFile> => {
      const bytes = change.deleted
        ? null
        : await sandbox.readBinaryFile({ path: `${REPO_DIR}/${change.path}` });
      return {
        content: bytes === null ? null : Buffer.from(bytes).toString("base64"),
        mode: modes.get(change.path) ?? "100644",
        path: change.path,
      };
    };
    const plans: CommitPlan[] = [];
    for (const group of grouping.groups) {
      const files: CommitFile[] = [];
      for (const change of group.changes) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time keeps memory bounded
        files.push(await read(change));
      }
      plans.push({ files, message: group.message });
    }
    let result: ChaseResult;
    try {
      result = await deliverFix({
        checks: checksOf(state.latest),
        commits: plans,
        pullRequestBody: fixPullRequestBody({
          baseline: state.baseline,
          latest: state.latest,
          messages: plans.map((plan) => plan.message),
          task,
        }),
        send: githubSend(await mintInstallationToken()),
        task,
      });
    } catch (error) {
      return {
        refused: `GitHub refused part of the push: ${String(error)}. Call stop_chase with this reason.`,
      };
    }
    chaseState.update((current) => ({ ...current, result }));
    await releaseSandbox(() => ctx.getSandbox());
    return { result };
  },
  inputSchema: z.object({
    commits: z
      .array(
        z.object({
          message: z
            .string()
            .min(1)
            .max(4000)
            .describe(
              "type(scope): imperative summary, a blank line, then what failed and what changed."
            ),
          paths: z
            .array(z.string().min(1))
            .min(1)
            .describe(
              "The changed files this commit holds, relative to the repository root."
            ),
        })
      )
      .min(1)
      .max(10),
  }),
});
