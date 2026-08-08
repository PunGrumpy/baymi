import { defineSchedule } from "eve/schedules";

import slack from "#channels/slack.js";
import { env } from "#lib/env.js";

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
 * - The digest's structure and formatting rules live in the `digest-format`
 *   skill; the prompt only carries what the skill cannot know (repo and the
 *   fetch-fresh rule).
 */
export default defineSchedule({
  cron: "0 9 * * 1",
  run({ appAuth, to, waitUntil }) {
    waitUntil(
      to(slack, { channelId: env.DIGEST_SLACK_CHANNEL }).send(
        [
          `Fetch all open issues on ${env.DIGEST_REPO} using the GitHub tools and compose this week's issues digest. Your reply is posted to the digest Slack channel; do not send it anywhere yourself.`,
          "Fetch the issues fresh in this run; never reuse counts or lists from earlier context.",
          `Open with one line naming the repository and the week: "Weekly issues digest: ${env.DIGEST_REPO}" and the date. The rest is the digest itself, with no preamble or commentary about the task.`,
          "Load the digest-format skill and follow it for the digest's structure: the grouping, one-line issue summaries, citations, overview, and the closing invitation to reply in the thread.",
        ].join("\n\n"),
        { auth: appAuth }
      )
    );
  },
});
