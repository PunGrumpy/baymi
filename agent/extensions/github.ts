import githubExtension from "@github-tools/eve-extension";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";

import { env } from "#lib/env";
import {
  assignWrite,
  autonomousWrite,
  conversationWrite,
  gatedWrite,
  labelWrite,
  pullRequestWrite,
} from "#lib/github/approval";
import { GITHUB_TOOLS } from "#lib/github/tools";

/**
 * GitHub tool set, mounted under the `github` namespace.
 *
 * @remarks
 * `requireApproval` policies are defined inline so eve can generate durable
 * descriptors for each approval callback without failing at step.started.
 */
export default githubExtension({
  connector: env.GITHUB_CONNECTOR,
  include: GITHUB_TOOLS,
  requireApproval: {
    addAssignees: (ctx: ApprovalContext): ApprovalStatus =>
      assignWrite(ctx.session.auth.current, ctx.toolInput),
    addIssueComment: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
    addLabels: (ctx: ApprovalContext): ApprovalStatus =>
      autonomousWrite(ctx.session.auth.current),
    addPullRequestComment: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
    closeIssue: (ctx: ApprovalContext): ApprovalStatus =>
      gatedWrite(ctx.session.auth.current),
    createIssue: (ctx: ApprovalContext): ApprovalStatus =>
      gatedWrite(ctx.session.auth.current),
    createLabel: (ctx: ApprovalContext): ApprovalStatus =>
      labelWrite(ctx.session.auth.current, ctx.toolInput),
    createPullRequest: (ctx: ApprovalContext): ApprovalStatus =>
      pullRequestWrite(ctx.session.auth.current, ctx.toolInput),
    removeAssignees: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
    removeLabel: (ctx: ApprovalContext): ApprovalStatus =>
      conversationWrite(ctx.session.auth.current),
  },
});
