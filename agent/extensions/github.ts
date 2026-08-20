import githubExtension from "@github-tools/eve-extension";

import { env } from "#lib/env";

/**
 * GitHub tool set, mounted under the `github` namespace.
 *
 * @remarks
 * `connectGithubTools` from `@github-tools/sdk/connect/eve` is deprecated in
 * 1.10.0: a `defineTool` inside `node_modules` is not hoisted, so its tools do
 * not survive multi-turn eve Workflow replay, and every surface here is
 * multi-turn. The extension also ships pre-built, which is why `agent.ts` needs
 * no `build.externalDependencies` entry for `@vercel/connect`.
 *
 * The `maintainer` preset covers the agreed scope, up to merging pull requests
 * and pushing branches. It also registers the gist tools, which a Connect
 * installation token cannot use since GitHub grants gist access only to user
 * tokens, so those fail if the model reaches for them.
 *
 * Approval is decided by what a write leaves behind for someone else to find.
 * Commenting and labelling run without it: they are the substance of answering
 * a mention or working a triage pass, they are reversible in one click, and
 * gating the reply the session exists to post would strand every GitHub
 * thread. Creating and closing an issue do carry approval: both put something
 * durable in front of the reporter, and both are worth a beat of confirmation.
 * Everything else, `mergePullRequest` and `createOrUpdateFile` included, keeps
 * approval-by-default.
 *
 * The earlier version of this list also waived approval on `createIssue` and
 * `closeIssue`, on the grounds that the email surface could not render an
 * approval prompt. Email is gone; Slack renders approval cards, and so do
 * Linear and GitHub, so the exemption went with it.
 */
export default githubExtension({
  connector: env.GITHUB_CONNECTOR,
  preset: "maintainer",
  requireApproval: {
    addIssueComment: "never",
    addLabels: "never",
    removeLabel: "never",
  },
});
