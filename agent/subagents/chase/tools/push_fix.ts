import { Buffer } from "node:buffer";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { bindingProblem, bindingRefusal } from "#lib/chase/bind";
import { budgetLeftMs } from "#lib/chase/budget";
import { fixVerdict, parseNameStatus } from "#lib/chase/checks";
import type { ChangedPath } from "#lib/chase/checks";
import { githubSend } from "#lib/chase/commit";
import type { CommitFile, CommitPlan } from "#lib/chase/commit";
import { deliverFix, groupCommits } from "#lib/chase/deliver";
import { checksOf, fixPullRequestBody } from "#lib/chase/report";
import type { ChaseResult } from "#lib/chase/result";
import { chaseState, endChase } from "#lib/chase/state";
import {
  BASELINE_TREE_COMMAND,
  CHANGES_COMMAND,
  commitMode,
  decodeListing,
  MODES_COMMAND,
  parseModes,
  REPO_DIR,
  TREE_COMMAND,
  treeId,
} from "#lib/chase/workspace";
import { env } from "#lib/env";
import { mintInstallationToken } from "#lib/github/credentials";
import { releaseSandbox } from "#lib/sandbox";

/**
 * Pushes a verified fix as atomic commits, to the pull request's branch or
 * as a pull request against it.
 *
 * @remarks
 * The model names the commits: a message and the files for each. Everything
 * else comes from state and from GitHub. The checkout in state is held to
 * the session's auth once more before anything is read or pushed
 * (`#lib/chase/bind`). The verdict is the check record's,
 * compared with the tree id taken now (the change is that tree minus the
 * clean checkout, so only the model's own edits go), and an unverified change
 * is refused rather than pushed: it goes to `stop_chase` instead. Where the
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
    const problem = bindingProblem(ctx.session.auth.current, task, {
      slackTeamId: env.SLACK_TEAM_ID,
    });
    if (problem !== null) {
      const result = bindingRefusal(ctx.session.auth.current, task, problem);
      chaseState.update((current) => endChase(current, result));
      await releaseSandbox(() => ctx.getSandbox());
      return { refused: problem, result };
    }
    if (budgetLeftMs(state.startedAt, Date.now()) <= 0) {
      return { refused: "The sandbox budget is spent. Call stop_chase." };
    }
    const sandbox = await ctx.getSandbox();
    const listed = await sandbox.run({ command: CHANGES_COMMAND });
    if (listed.exitCode !== 0) {
      return {
        refused: `Listing the change failed: ${listed.stderr.trim()}. Call stop_chase with this reason.`,
      };
    }
    const changes = parseNameStatus(decodeListing(listed.stdout));
    const staged = await sandbox.run({ command: MODES_COMMAND });
    if (staged.exitCode !== 0) {
      return {
        refused: `Reading the file modes failed: ${staged.stderr.trim()}. Call stop_chase with this reason.`,
      };
    }
    const modes = parseModes(decodeListing(staged.stdout));
    const grouping = groupCommits(changes, commits, modes);
    if (!grouping.ok) {
      return { problems: grouping.problems, refused: "Nothing was pushed." };
    }
    const verdict = fixVerdict({
      baseline: state.baseline,
      cleanTree: state.cleanTree,
      currentDigest: treeId(await sandbox.run({ command: TREE_COMMAND })),
      headTree: treeId(await sandbox.run({ command: BASELINE_TREE_COMMAND })),
      latest: state.latest,
    });
    if (!verdict.verified) {
      return {
        reasons: verdict.reasons,
        refused:
          "The fix is not verified, so nothing was pushed. Run run_checks after your last edit, or call stop_chase.",
      };
    }
    const read = async (change: ChangedPath): Promise<CommitFile> => {
      const bytes = change.deleted
        ? null
        : await sandbox.readBinaryFile({ path: `${REPO_DIR}/${change.path}` });
      return {
        content: bytes === null ? null : Buffer.from(bytes).toString("base64"),
        mode: commitMode(modes, change.path),
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
