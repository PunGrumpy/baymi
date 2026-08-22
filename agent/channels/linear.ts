import { connectLinearCredentials } from "@vercel/connect/eve";
import { defaultLinearAuth, linearChannel } from "eve/channels/linear";

import { env } from "#lib/env";
import { failureDetail, failureNotice } from "#lib/failure";

/**
 * Linear channel: Agent Sessions in, Agent Activities out, via Vercel Connect.
 *
 * @remarks
 * Credentials are brokered by Vercel Connect, which supplies the app token and
 * verifies inbound webhooks by their Vercel OIDC signature. The
 * `onAgentSession` hook keeps the default created/prompted dispatch and adds
 * the requester's name and email as session context when Linear provides
 * them, so requests like "email me a summary" go to the right address without
 * asking.
 */
export default linearChannel({
  credentials: connectLinearCredentials(env.LINEAR_CONNECTOR),
  events: {
    async "session.failed"(event, channel) {
      console.error(failureDetail("session", event));
      await channel.linear.createActivity({
        body: failureNotice(
          "This session could not recover from an error",
          "Delegate the issue again to start a fresh one.",
          event
        ),
        type: "response",
      });
    },
    async "turn.failed"(event, channel) {
      console.error(failureDetail("turn", event));
      await channel.linear.createActivity({
        body: failureNotice(
          "I hit an error working on this",
          "Prompt me again on this session and I'll retry.",
          event
        ),
        type: "response",
      });
    },
  },
  onAgentSession: (_ctx, event) => {
    if (event.action !== "created" && event.action !== "prompted") {
      return null;
    }
    const requester = event.agentActivity?.user ?? event.agentSession.creator;
    const context: string[] = [];
    if (requester?.email) {
      context.push(
        `The requesting user is ${requester.displayName ?? requester.name ?? "unknown"} (${requester.email}). When they ask you to send them something, resolve that email to their Slack account with \`send_slack_dm\` unless they name someone else.`
      );
    }
    return { auth: defaultLinearAuth(event), context };
  },
});
