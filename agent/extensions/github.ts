import githubExtension from "@github-tools/eve-extension";

import { env } from "#lib/env";
import { githubWriteApprovals } from "#lib/github/approval";
import { GITHUB_TOOLS } from "#lib/github/tools";

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
 * `include` rather than a preset, because a preset is priced per turn: see
 * `agent/lib/github/tools.ts` for what is mounted and why the rest is not.
 *
 * Approval is decided per session, in `agent/lib/github/approval.ts`, rather
 * than per tool here. That module carries the reasoning; the short version is
 * that an unattended turn is refused every write, and an attended one skips
 * the card only for the comment and labels its reply is made of.
 */
export default githubExtension({
  connector: env.GITHUB_CONNECTOR,
  include: GITHUB_TOOLS,
  requireApproval: githubWriteApprovals(),
});
