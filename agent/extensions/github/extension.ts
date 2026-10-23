import githubExtension from "@github-tools/eve-extension";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

import { env } from "#lib/env";
import {
  conversationWrite,
  gatedWrite,
  rerunWrite,
} from "#lib/github/approval";
import { mintInstallationToken } from "#lib/github/credentials";
import { githubReader } from "#lib/github/rerun";
import { GITHUB_TOOLS } from "#lib/github/tools";

/**
 * GitHub tool set, mounted under the `github` namespace.
 *
 * @remarks
 * `requireApproval` policies are written inline so eve can generate a
 * durable descriptor for each one; a policy built by a factory has none and
 * fails a resumed session at `step.started`. The decisions themselves live
 * in `agent/lib/github/approval.ts`, which is what the tests reach.
 *
 * It is a directory mount so `tools/github.ts` can sit beside the declaration
 * and take the CI tools out of a review turn's prompt; the namespace is still
 * the directory's name.
 */
export default githubExtension({
  connector: env.GITHUB_CONNECTOR,
  include: GITHUB_TOOLS,
  requireApproval: {
    addIssueComment: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
    addPullRequestComment: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
    createIssue: (ctx: ApprovalContext): ApprovalStatus =>
      gatedWrite(ctx.session.auth.current),
    replyToReviewComment: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
    rerunWorkflowRun: (ctx: ApprovalContext): Promise<ApprovalStatus> =>
      rerunWrite(
        ctx.session.auth.current,
        ctx.toolInput,
        githubReader(mintInstallationToken)
      ),
  },
});
