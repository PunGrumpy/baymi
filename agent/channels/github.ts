import { connectGitHubCredentials } from "@vercel/connect/eve";
import type { GitHubEventContext } from "eve/channels/github";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

import { env } from "#lib/env";
import { failureNotice, logFailure } from "#lib/failure";
import { BOT_NAME, shouldDispatchComment } from "#lib/github/comments";
import { escalateFailedTriage } from "#lib/github/escalate";
import { isAutonomousTriageState, shouldTriageIssue } from "#lib/github/issues";
import { AUTONOMOUS_GITHUB_PRINCIPAL, isAutonomous } from "#lib/trust";

/**
 * Hands a failed triage to the maintainer instead of posting the error.
 *
 * @remarks
 * Both failure handlers below route here, and neither coordinates with the
 * other: every call the escalation makes is idempotent, so a turn failing and
 * then its session failing escalates once as far as GitHub is concerned. What
 * the escalation could not do is logged, because the whole point of this path
 * is that nothing is posted, and an escalation that silently did not happen
 * would look exactly like one that did.
 */
const escalate = async (channel: GitHubEventContext): Promise<void> => {
  const { issueNumber, owner, repo } = channel.state;
  if (issueNumber === null) {
    return;
  }
  const failed = await escalateFailedTriage(
    async (input) => {
      await channel.github.request(input);
    },
    { issueNumber, owner, repo }
  );
  if (failed.length > 0) {
    logFailure("escalation", {
      message: `could not ${failed.join(" or ")} on ${owner}/${repo}#${issueNumber}`,
    });
  }
};

/**
 * GitHub App credentials: installation tokens from Vercel Connect, webhooks
 * verified against the App's own secret.
 *
 * @remarks
 * The App posts its webhooks straight at `/eve/v1/github` rather than through
 * Connect's trigger forwarder. Forwarding is metered per delivery, and this
 * repository's own CI and review traffic runs about sixteen times the Hobby
 * allowance on `issue_comment` alone; the events are identical either way, so
 * the forwarder was buying nothing but the bill.
 *
 * `connectGitHubCredentials` returns a `webhookVerifier` that checks the Vercel
 * OIDC signature Connect attaches on the way out. A webhook that came straight
 * from GitHub does not carry one, and eve skips the `webhookSecret` path
 * entirely whenever a verifier is present, so the verifier is dropped here
 * rather than left in place to reject every delivery. `installationToken` is
 * untouched: token minting, rotation, and tenancy stay inside Connect, and
 * there is still no App private key in this deployment.
 */
const { webhookVerifier: _connectForwarderVerifier, ...connectGitHub } =
  connectGitHubCredentials(env.GITHUB_CONNECTOR);

/**
 * GitHub channel: @mentions on issues and pull requests, answered in-thread as
 * `baymiai`, and an unattended first reply on issues opened by people outside
 * the repository.
 *
 * @remarks
 * - Credentials are brokered by Vercel Connect. The connector UID comes from
 *   `GITHUB_CONNECTOR`; tokens are resolved per call and never exposed to the
 *   model. Inbound webhooks arrive straight from GitHub and are checked against
 *   `GITHUB_WEBHOOK_SECRET`; see the credentials above for why.
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
  credentials: { ...connectGitHub, webhookSecret: env.GITHUB_WEBHOOK_SECRET },
  events: {
    async "session.failed"(event, channel) {
      logFailure("session", event);
      // A failed triage posts nothing: the reporter did not ask for this turn
      // and should not be handed the agent's error in their own issue. It goes
      // to the maintainer's notifications instead.
      if (isAutonomousTriageState(channel.state)) {
        await escalate(channel);
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
      logFailure("turn", event);
      if (isAutonomous(ctx.session.auth.current)) {
        await escalate(channel);
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
