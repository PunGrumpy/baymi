import { Buffer } from "node:buffer";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { mintInstallationToken } from "#lib/github/credentials";
import type { ChangedPath } from "#lib/remediation/checks";
import { parseNameStatus, verdict } from "#lib/remediation/checks";
import type { CommitFile } from "#lib/remediation/commit";
import {
  branchName,
  githubSend,
  pushDraftPullRequest,
} from "#lib/remediation/commit";
import {
  remediationBody,
  remediationTitle,
} from "#lib/remediation/pull-request";
import { remediationState } from "#lib/remediation/state";
import {
  CHANGES_COMMAND,
  DIGEST_COMMAND,
  isPushablePath,
  MAX_CHANGED_FILES,
  MODES_COMMAND,
  parseModes,
  REPO_DIR,
} from "#lib/remediation/workspace";
import { releaseSandbox } from "#lib/sandbox";

/**
 * Pushes the change as a draft pull request, and decides from the recorded
 * checks whether to call it verified.
 *
 * @remarks
 * The repository, the base commit and the branch come from the task in
 * durable state, not from the model. The verdict comes from the check
 * record, compared with a digest of the change taken now. The files come
 * from the sandbox as bytes; the runtime pushes them through the Git Data
 * API with the installation token, which never enters the sandbox. Once the
 * pull request is open the sandbox is deleted, and a second call is refused.
 */
export default defineTool({
  description:
    "Push your change and open the draft pull request. Call it once, after your last run_checks. " +
    "Pass notes on what you changed beyond the version bump and why. It answers with the link and whether the change is verified.",
  async execute({ notes }, ctx) {
    const state = remediationState.get();
    const { task } = state;
    if (task === null) {
      return { refused: "Call prepare_checkout first." };
    }
    if (state.pullRequestUrl !== null) {
      return { refused: `Already submitted: ${state.pullRequestUrl}` };
    }
    if (task.fixedVersion === null) {
      return {
        refused:
          "No advisory names a patched version, so there is no fix to push.",
      };
    }
    const sandbox = await ctx.getSandbox();
    const listed = await sandbox.run({ command: CHANGES_COMMAND });
    const changes = parseNameStatus(listed.stdout);
    if (changes.length === 0) {
      return { refused: "Nothing changed in the repository." };
    }
    if (changes.length > MAX_CHANGED_FILES) {
      return {
        refused: `${changes.length} files changed, more than the ${MAX_CHANGED_FILES} a dependency fix should touch.`,
      };
    }
    const unsafe = changes.find((change) => !isPushablePath(change.path));
    if (unsafe !== undefined) {
      return { refused: `Refusing to push ${unsafe.path}.` };
    }
    const staged = await sandbox.run({ command: MODES_COMMAND });
    const modes = parseModes(staged.stdout);
    const read = async (change: ChangedPath) =>
      change.deleted
        ? null
        : await sandbox.readBinaryFile({ path: `${REPO_DIR}/${change.path}` });
    const files: CommitFile[] = [];
    for (const change of changes) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time keeps memory bounded
      const bytes = await read(change);
      files.push({
        content: bytes === null ? null : Buffer.from(bytes).toString("base64"),
        mode: modes.get(change.path) ?? "100644",
        path: change.path,
      });
    }
    const digestRun = await sandbox.run({ command: DIGEST_COMMAND });
    const currentDigest = digestRun.stdout.trim();
    const result = verdict({
      currentDigest,
      ecosystem: task.ecosystem,
      record: state.checks,
    });
    const title = remediationTitle(task);
    const pull = await pushDraftPullRequest({
      base: task.defaultBranch,
      baseSha: task.baseSha,
      body: remediationBody({
        notes,
        results: state.checks?.results ?? [],
        task,
        verdict: result,
      }),
      branch: branchName({
        baseSha: task.baseSha,
        fixedVersion: task.fixedVersion,
        packageName: task.packageName,
      }),
      files,
      message: title,
      repository: task.repository,
      send: githubSend(await mintInstallationToken()),
      title,
    });
    remediationState.update((current) => ({
      ...current,
      pullRequestUrl: pull.url,
    }));
    await releaseSandbox(() => ctx.getSandbox());
    return {
      reasons: result.reasons,
      url: pull.url,
      verified: result.verified,
    };
  },
  inputSchema: z.object({
    notes: z
      .string()
      .max(4000)
      .describe(
        "What you changed beyond the version bump, and why. Empty when the bump was all."
      ),
  }),
});
