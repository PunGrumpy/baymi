import { connect } from "@vercel/connect/eve";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env.js";

/**
 * App-scoped Slack authorization for sending messages outside a Slack session.
 *
 * @remarks
 * The Slack channel handles its own delivery; this exists for the other
 * surfaces, a Linear session asked to "DM me a summary" being the main one.
 * The connector's Bot Scopes must include `chat:write`, `im:write`, and
 * `users:read.email` for the lookup below.
 */
const slackAuth = connect({
  connector: env.SLACK_CONNECTOR,
  principalType: "app",
});

const SLACK_API = "https://slack.com/api";

const slackCall = async (
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const res = await fetch(`${SLACK_API}/${method}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  return (await res.json()) as Record<string, unknown>;
};

/**
 * Sends a Slack direct message to a workspace member, resolved by email.
 *
 * @remarks
 * Delivery path: `users.lookupByEmail` to resolve the member,
 * `conversations.open` for the DM conversation, `chat.postMessage` to send.
 * Slack renders mrkdwn, not full Markdown: `*bold*`, `_italic_`,
 * `<url|label>` links, no headings or tables.
 */
export default defineTool({
  description:
    "Send a Slack direct message to a workspace member, looked up by their email address. " +
    "Use this to deliver something a user asked for from another surface, like a summary " +
    "requested in a Linear session. Never use it to reply in a Slack session: that reply is " +
    "posted for you, and sending it here too would deliver it twice. Format the message as " +
    "Slack mrkdwn (*bold*, <url|label> links), not Markdown.",
  async execute({ email, message }, ctx) {
    const { token } = await ctx.getToken(slackAuth);

    const user = await slackCall(token, "users.lookupByEmail", { email });
    if (!user.ok) {
      return {
        error: `No Slack member found for ${email} (${String(user.error)}).`,
        success: false,
      };
    }
    const userId = (user.user as { id: string }).id;

    const dm = await slackCall(token, "conversations.open", { users: userId });
    if (!dm.ok) {
      return {
        error: `Could not open a DM conversation (${String(dm.error)}).`,
        success: false,
      };
    }
    const channelId = (dm.channel as { id: string }).id;

    const posted = await slackCall(token, "chat.postMessage", {
      channel: channelId,
      text: message,
    });
    if (!posted.ok) {
      return {
        error: `Message was not delivered (${String(posted.error)}).`,
        success: false,
      };
    }
    return { success: true };
  },
  inputSchema: z.object({
    email: z
      .email()
      .describe("Email address of the Slack workspace member to DM."),
    message: z
      .string()
      .min(1)
      .describe("The message, formatted as Slack mrkdwn."),
  }),
  outputSchema: z.object({
    error: z.string().optional(),
    success: z.boolean(),
  }),
});
