import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

import { env } from "#lib/env";
import { failureNotice } from "#lib/failure";
import { BOT_NAME, shouldDispatchComment } from "#lib/github/comments";
import { isAutonomousTriageState, shouldTriageIssue } from "#lib/github/issues";
import { AUTONOMOUS_GITHUB_PRINCIPAL, isAutonomous } from "#lib/trust";

/**
 * GitHub channel: @mentions on issues and pull requests, answered in-thread as
 * `baymiai`, and an unattended first reply on issues opened by people outside
 * the repository.
 *
 * @remarks
 * - Credentials are brokered by Vercel Connect. The connector UID comes from
 *   `GITHUB_CONNECTOR`; tokens are resolved per call and never exposed to the
 *   model.
 * - `onComment` replaces the built-in mention gate with
 *   `shouldDispatchComment`, which keeps the default mention and ignore rules
 *   and adds the authorization check from `agent/lib/trust.ts`: only a
 *   commenter the repo trusts (owner, member, or collaborator) starts a
 *   session. Mentions from anyone else are acknowledged without one, so
 *   arbitrary accounts on a public repo cannot drive the agent's write tools.
 * - There is no `onPullRequest`, `onCheckSuite`, or `onWorkflowRun` hook. A
 *   pull request opening is not a request for anything: the agent answers on a
 *   PR when someone mentions it there, which arrives through `onComment` like
 *   any other mention. Every reply on this channel is the turn's own completed
 *   message, which the channel posts into the thread.
 */
export default githubChannel({
  botName: BOT_NAME,
  credentials: connectGitHubCredentials(env.GITHUB_CONNECTOR),
  events: {
    async "session.failed"(event, channel) {
      // A failed triage stays quiet: the reporter did not ask for this turn
      // and should not be handed the agent's error in their own issue.
      if (isAutonomousTriageState(channel.state)) {
        return;
      }
      await channel.thread.post(
        failureNotice(
          "This session could not recover from an error",
          "Send a new mention in this thread to start a fresh one.",
          event
        )
      );
    },
    async "turn.failed"(event, channel, ctx) {
      if (isAutonomous(ctx.session.auth.current)) {
        return;
      }
      await channel.thread.post(
        failureNotice(
          "I hit an error working on this",
          "Mention me again in this thread and I'll retry.",
          event
        )
      );
    },
  },
  onComment: (ctx, comment) =>
    shouldDispatchComment(comment) ? { auth: defaultGitHubAuth(ctx) } : null,
  onIssue: (ctx, issue) =>
    shouldTriageIssue(issue, ctx.sender.login, BOT_NAME)
      ? {
          auth: {
            ...defaultGitHubAuth(ctx),
            principalId: AUTONOMOUS_GITHUB_PRINCIPAL,
            principalType: "service",
          },
        }
      : null,
});
