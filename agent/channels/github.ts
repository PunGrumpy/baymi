import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

import { env } from "#lib/env";
import { failureNotice } from "#lib/failure";
import { BOT_NAME, shouldDispatchComment } from "#lib/github/comments";
import { isAutonomousTriageState, shouldTriageIssue } from "#lib/github/issues";
import { AUTONOMOUS_GITHUB_PRINCIPAL, isAutonomous } from "#lib/trust";

/**
 * Task injected into the session dispatched when a pull request opens. The
 * PR's metadata and changed-file patches are already in the session's context
 * when this runs; the repo itself is checked out into the sandbox.
 */
const PR_SUMMARY_TASK = [
  "A pull request was just opened. Post one comment that helps reviewers get oriented.",
  "Open with a short paragraph saying what the PR does and why, grounded in its title, description, and diff. Never guess at intent the diff doesn't show.",
  "Then add a markdown table breaking down the changed files: the file path, the kind of change (added, modified, removed, renamed), and what changed in one short phrase. For a very large PR, list the files that carry the substance and roll the rest into a final count row.",
  "Close with one line pointing reviewers at where to start. This comment is a summary, not a review: don't approve, request changes, or ask the author for anything.",
].join("\n\n");

/**
 * GitHub channel: @mentions on issues and pull requests, answered in-thread as
 * `baymiai`, plus a summary comment on every newly opened pull request.
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
 * - `onPullRequest` dispatches only on the `opened` action and skips PRs
 *   opened by bots (Dependabot and similar), so automated PRs don't each get
 *   a summary comment. It is deliberately not gated by `author_association`:
 *   summarizing outside contributors' PRs is the point, and the injected task
 *   is scoped to posting a single summary comment. All other PR actions are
 *   acknowledged without dispatching.
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
  onPullRequest: (ctx, pullRequest) =>
    pullRequest.action === "opened" && ctx.sender.type !== "Bot"
      ? { auth: defaultGitHubAuth(ctx), context: [PR_SUMMARY_TASK] }
      : null,
});
