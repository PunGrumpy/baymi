import { connectLinearCredentials } from "@vercel/connect/eve";
import { defaultLinearAuth, linearChannel } from "eve/channels/linear";

import { env } from "#lib/env";

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
