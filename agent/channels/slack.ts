import { connectSlackCredentials } from "@vercel/connect/eve";
import type {
  SlackInboundMessageContext,
  SlackMentionResult,
  SlackMessage,
} from "eve/channels/slack";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";

import { env } from "#lib/env";
import { failureLine, logFailure } from "#lib/failure";
import { isSlackHuman } from "#lib/trust";

/**
 * Admits a person from the agent's own workspace, and nobody else.
 *
 * @remarks
 * A valid signature proves Slack sent the event, not who typed it. Bots and
 * Slack Connect guests from another workspace get silence rather than a
 * turn; a human gets the typing indicator and a session under their own
 * principal, which is what memory and approval cards key on.
 */
const admit = async (
  ctx: SlackInboundMessageContext,
  message: SlackMessage
): Promise<SlackMentionResult> => {
  const auth = defaultSlackAuth(message, ctx);
  if (!isSlackHuman(auth, env.SLACK_TEAM_ID)) {
    return null;
  }
  await ctx.thread.startTyping("Thinking…");
  return { auth };
};

/**
 * Slack channel: direct messages, @mentions, and follow-ups in a thread the
 * agent is already working in.
 *
 * @remarks
 * The subscribed-thread case is what lets the maintainer keep talking
 * without re-mentioning the agent on every line. It needs `message.channels`
 * under the connector's trigger event types and `channels:history` under its
 * bot scopes (plus `message.groups` and `groups:history` for private
 * channels); without them only DMs and mentions reach the agent.
 *
 * `threadContext` limits the history loaded into a resumed thread to what
 * came after the agent's last reply, since everything before it is already
 * in the session.
 */
export default slackChannel({
  credentials: connectSlackCredentials(env.SLACK_CONNECTOR),
  events: {
    async "session.failed"(event, channel) {
      logFailure("session", event);
      await channel.thread.post(
        failureLine(
          "This conversation hit an error it could not recover from",
          "Start a new one and I'll pick it up.",
          event
        )
      );
    },
    async "turn.failed"(event, channel) {
      logFailure("turn", event);
      await channel.thread.post(
        failureLine(
          "I hit an error working on that",
          "Reply here and I'll retry.",
          event
        )
      );
    },
  },
  onAppMention: admit,
  onDirectMessage: admit,
  onInputResponse: (ctx) =>
    isSlackHuman(ctx.defaultAuth, env.SLACK_TEAM_ID)
      ? { auth: ctx.defaultAuth }
      : null,
  async onMessage(ctx, message) {
    // Mentions are dispatched by `onAppMention`; the matching `message` event
    // is dropped here. Anything else only continues a thread the agent owns.
    if (ctx.isBotMentioned() || !(await ctx.isSubscribed())) {
      return null;
    }
    return admit(ctx, message);
  },
  threadContext: { since: "last-agent-reply" },
});
