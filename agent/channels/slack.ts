import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

import { env } from "#lib/env.js";

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
