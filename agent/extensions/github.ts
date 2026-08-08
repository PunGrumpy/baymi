import githubExtension from "@github-tools/eve-extension";

import { env } from "#lib/env.js";

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
 * Issue-conversation writes run without approval: they are reversible actions on
 * the configured repo, and the email surface cannot render an approval prompt,
 * so a gate there would strand the session. Everything else, `mergePullRequest`
 * and `createOrUpdateFile` included, keeps approval-by-default.
 */
export default githubExtension({
  connector: env.GITHUB_CONNECTOR,
  preset: "maintainer",
  requireApproval: {
    addIssueComment: "never",
    addLabels: "never",
    closeIssue: "never",
    createIssue: "never",
    removeLabel: "never",
  },
});
