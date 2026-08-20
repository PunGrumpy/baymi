import { connect } from "@vercel/connect/eve";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env";
import { exposesSlackDmTool } from "#lib/slack";

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

const DESCRIPTION =
  "Send a Slack direct message to a workspace member, looked up by their email address. " +
  "Use this to deliver something a user asked for from another surface, like a summary " +
  "requested in a Linear session. It is not available in Slack sessions, where your reply " +
  "is posted to the thread for you. Format the message as Slack mrkdwn " +
  "(*bold*, <url|label> links), not Markdown.";

const inputSchema = z.object({
  email: z
    .email()
    .describe("Email address of the Slack workspace member to DM."),
  message: z
    .string()
    .min(1)
    .describe("The message, formatted as Slack mrkdwn."),
});

const outputSchema = z.object({
  error: z.string().optional(),
  success: z.boolean(),
});

/**
 * Sends a Slack direct message to a workspace member, resolved by email.
 *
 * @remarks
 * Delivery path: `users.lookupByEmail` to resolve the member,
 * `conversations.open` for the DM conversation, `chat.postMessage` to send.
 * Slack renders mrkdwn, not full Markdown: `*bold*`, `_italic_`,
 * `<url|label>` links, no headings or tables.
 *
 * Resolved per session rather than declared statically so `exposesSlackDmTool`
 * can withhold it from Slack sessions, where the agent's reply is posted to
 * the thread already and a DM would deliver the same thing twice. That
 * includes the weekly digest, which runs as a Slack session. A single returned
 * tool keeps the file's name, so the model still sees `send_slack_dm`.
 *
 * `execute` is written inline in the resolver on purpose: eve rebuilds it from
 * its stored closure when a step replays, and a hoisted reference would not
 * survive that.
 */
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      exposesSlackDmTool(ctx.channel.kind)
        ? defineTool({
            description: DESCRIPTION,
            async execute({ email, message }, toolCtx) {
              const { token } = await toolCtx.getToken(slackAuth);

              const user = await slackCall(token, "users.lookupByEmail", {
                email,
              });
              if (!user.ok) {
                return {
                  error: `No Slack member found for ${email} (${String(user.error)}).`,
                  success: false,
                };
              }
              const userId = (user.user as { id: string }).id;

              const dm = await slackCall(token, "conversations.open", {
                users: userId,
              });
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
            inputSchema,
            outputSchema,
          })
        : null,
  },
});
