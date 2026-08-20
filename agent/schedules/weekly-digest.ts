import { defineSchedule } from "eve/schedules";

import slack from "#channels/slack";
import { digestPrompt } from "#lib/digest";
import { env } from "#lib/env";

/**
 * Weekly GitHub issues digest, composed by the agent and posted to the
 * configured Slack channel.
 *
 * @remarks
 * - Fires every Monday at 09:00 UTC (`"0 9 * * 1"`); on Vercel each schedule
 *   becomes a Vercel Cron Job and the expression is evaluated in UTC.
 * - Handler form: `to(slack, ...)` starts the session on the Slack channel, so
 *   the agent's final message is delivered into `DIGEST_SLACK_CHANNEL` and
 *   replies in that thread resume the session through the channel's
 *   subscribed-thread policy. The agent does not send anything itself.
 * - One session per repository in `DIGEST_REPOS`, each landing in its own
 *   thread because a send with no thread carries no continuation to join. That
 *   is the point: an issue number in a reply resolves against one repository,
 *   so "create Linear issues for #1 and #2" is never ambiguous.
 * - The digest's structure and formatting rules live in the `digest-format`
 *   skill; `digestPrompt` carries only what the skill cannot know (the repo and
 *   the fetch-fresh rule).
 */
export default defineSchedule({
  cron: "0 9 * * 1",
  run({ appAuth, to, waitUntil }) {
    for (const repo of env.DIGEST_REPOS) {
      waitUntil(
        to(slack, { channelId: env.DIGEST_SLACK_CHANNEL }).send(
          digestPrompt(repo),
          { auth: appAuth }
        )
      );
    }
  },
});
