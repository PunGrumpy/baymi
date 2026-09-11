import githubExtension from "@github-tools/eve-extension";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

import { env } from "#lib/env";
import { conversationWrite, gatedWrite } from "#lib/github/approval";
import { GITHUB_TOOLS } from "#lib/github/tools";

/**
 * GitHub tool set, mounted under the `github` namespace.
 *
 * @remarks
 * `requireApproval` policies are written inline so eve can generate a
 * durable descriptor for each one; a policy built by a factory has none and
 * fails a resumed session at `step.started`. The decisions themselves live
 * in `agent/lib/github/approval.ts`, which is what the tests reach.
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
  },
});
