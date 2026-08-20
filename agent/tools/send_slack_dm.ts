import { connect } from "@vercel/connect/eve";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env";
import { exposesSlackDmTool } from "#lib/slack";
import { isAutonomous } from "#lib/trust";

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

/**
 * One Slack Web API call, parsed into the shape the caller asked for.
 *
 * @remarks
 * The schema is a parameter rather than a cast at the call site so the response
 * never reaches the tool body unparsed: a body Slack changed the shape of
 * fails here, with the method name in the error, instead of surfacing as an
 * undefined property three lines later.
 */
const slackCall = async <Payload>(
  schema: z.ZodType<Payload>,
  token: string,
  method: string,
  body: Readonly<Record<string, string>>
): Promise<Payload> => {
  const res = await fetch(`${SLACK_API}/${method}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  return schema.parse(await res.json());
};

/**
 * The failure envelope every Slack Web API method shares. `error` is the
 * machine-readable reason, which is what gets handed back to the model.
 */
const slackFailure = z.object({
  error: z.string().default("unknown_error"),
  ok: z.literal(false),
});

/**
 * Slack responses, parsed rather than asserted.
 *
 * @remarks
 * A successful body must carry the id the next call needs, so a response that
 * says `ok` without one fails here with a readable message instead of throwing
 * on a property access three lines later.
 */
const memberLookup = z.union([
  z.object({ ok: z.literal(true), user: z.object({ id: z.string() }) }),
  slackFailure,
]);

const conversationOpen = z.union([
  z.object({ channel: z.object({ id: z.string() }), ok: z.literal(true) }),
  slackFailure,
]);

const messagePosted = z.union([
  z.object({ ok: z.literal(true) }),
  slackFailure,
]);

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
      exposesSlackDmTool(ctx.channel.kind) &&
      !isAutonomous(ctx.session.auth.current)
        ? defineTool({
            description: DESCRIPTION,
            async execute({ email, message }, toolCtx) {
              const { token } = await toolCtx.getToken(slackAuth);

              const user = await slackCall(
                memberLookup,
                token,
                "users.lookupByEmail",
                { email }
              );
              if (!user.ok) {
                return {
                  error: `No Slack member found for ${email} (${user.error}).`,
                  success: false,
                };
              }

              const dm = await slackCall(
                conversationOpen,
                token,
                "conversations.open",
                { users: user.user.id }
              );
              if (!dm.ok) {
                return {
                  error: `Could not open a DM conversation (${dm.error}).`,
                  success: false,
                };
              }

              const posted = await slackCall(
                messagePosted,
                token,
                "chat.postMessage",
                { channel: dm.channel.id, text: message }
              );
              if (!posted.ok) {
                return {
                  error: `Message was not delivered (${posted.error}).`,
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
