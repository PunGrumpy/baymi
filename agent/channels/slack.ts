import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

import { env } from "#lib/env";
import { failureLine, logFailure } from "#lib/failure";

/**
 * Slack channel: @mentions, DMs, and follow-ups in threads the agent is already
 * working in.
 *
 * @remarks
 * The subscribed-thread case is what lets someone keep talking without
 * re-mentioning the agent on every line. It needs Slack permissions the default
 * connector does not request: add `message.channels` under Trigger Event Types
 * and `channels:history` under Bot Scopes when creating the connector (plus
 * `message.groups` and `groups:history` for private channels). Without them
 * `isSubscribed()` never fires and only DMs and mentions reach the agent.
 *
 * eve filters the agent's own messages before this hook; the `isBot` check drops
 * messages from other bots too, which would otherwise loop.
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
  async onMessage(ctx, message) {
    if (message.author?.isBot) {
      return null;
    }
    const isDirectMessage = message.raw.channel_type === "im";
    const shouldDispatch =
      isDirectMessage || ctx.isBotMentioned() || (await ctx.isSubscribed());
    return shouldDispatch ? { auth: null } : null;
  },
});
