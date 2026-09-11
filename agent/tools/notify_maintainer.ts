import { getToken } from "@vercel/connect";
import type { DynamicEvents } from "eve/tools";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env";
import { pullRequestFromAuth } from "#lib/github/pull-requests";
import { channelName } from "#lib/instructions";
import {
  checkInMessage,
  NOTIFIED_SEVERITIES,
  postSlackMessage,
} from "#lib/slack/notify";
import { isUnattended } from "#lib/trust";

const DESCRIPTION =
  "Send the maintainer a one-line check-in on Slack about a critical or high finding on the pull request you are reviewing. " +
  "Call it at most once per review, after the finding is confirmed against the code and only when the maintainer should hear before they next open GitHub. " +
  "The message names the pull request itself; you supply the severity and one plain sentence.";

const SUMMARY_MAX = 200;

/**
 * Whether this session gets the check-in tool at all.
 *
 * @remarks
 * Only an unattended review on the GitHub channel, and only when there is
 * somewhere to send it. On Slack the maintainer already reads the reply, and on an attended
 * GitHub turn they asked and are reading. The
 * resolver runs at both `session.started` and `turn.started`, so a later
 * mention by a person on the same pull request re-resolves to nothing.
 */
const resolveNotifyTool: NonNullable<DynamicEvents["turn.started"]> = (
  _event,
  ctx
) => {
  const target = env.SLACK_NOTIFY_CHANNEL;
  if (
    target === undefined ||
    channelName(ctx.channel.kind) !== "github" ||
    !isUnattended(ctx.session.auth.current)
  ) {
    return null;
  }
  // `execute` is written inline on purpose: eve rebuilds it from its stored
  // closure when a step replays, and a hoisted reference would not survive.
  return defineTool({
    description: DESCRIPTION,
    async execute({ severity, summary }, toolCtx) {
      // The pull request comes from the auth the channel minted at dispatch,
      // never from the model, so a diff cannot point the check-in elsewhere.
      const pullRequest = pullRequestFromAuth(
        toolCtx.session.auth.initiator ?? toolCtx.session.auth.current
      );
      if (pullRequest === null) {
        return {
          delivered: false,
          error: "This session is not anchored to a pull request.",
        };
      }
      const token = await getToken(env.SLACK_CONNECTOR, {
        subject: { type: "app" },
      });
      const delivery = await postSlackMessage({
        message: checkInMessage({
          event: { kind: "finding", severity, summary },
          now: new Date(),
          pullRequest,
        }),
        target,
        token,
      });
      return delivery.ok
        ? { delivered: true }
        : { delivered: false, error: delivery.error };
    },
    inputSchema: z.object({
      severity: z
        .enum(NOTIFIED_SEVERITIES)
        .describe(
          "critical or high; anything lower waits for the maintainer to ask."
        ),
      summary: z
        .string()
        .trim()
        .min(1)
        .max(SUMMARY_MAX)
        .describe(
          "One plain sentence naming the finding, without a file path or code. The comment on the pull request has the detail."
        ),
    }),
    outputSchema: z.object({
      delivered: z.boolean(),
      error: z.string().optional(),
    }),
  });
};

export default defineDynamic({
  events: {
    "session.started": resolveNotifyTool,
    "turn.started": resolveNotifyTool,
  },
});
