import { getToken } from "@vercel/connect";
import { defineSchedule } from "eve/schedules";
import { log } from "evlog";

import { listOpenPullRequests } from "#lib/digest/github";
import { DIGEST_EVENT_TYPE, runDigest } from "#lib/digest/run";
import { env } from "#lib/env";
import { mintInstallationToken } from "#lib/github/credentials";
import { listInstalledRepositories } from "#lib/github/installation";
import { hasKeyedMessage, postKeyedText } from "#lib/slack/messages";

/**
 * The weekday morning digest: 08:00 in Bangkok is 01:00 UTC, and Vercel
 * evaluates cron in UTC. One fire a day is what a Hobby plan allows, and it
 * may land up to an hour late (`docs/notes.md`).
 *
 * @remarks
 * Wiring only. `runDigest` reads the open pull requests, classifies them,
 * renders the Thai text and posts it once; this file supplies the GitHub
 * installation token and the Slack connector token. There is no model turn
 * and no tool: the handler writes nothing to GitHub and nothing to memory,
 * and the one Slack post is tagged with the digest key so a second delivery
 * of the same fire finds it and posts nothing.
 */
export default defineSchedule({
  cron: "0 1 * * 1-5",
  async run({ appAuth }) {
    const target = env.SLACK_NOTIFY_CHANNEL;
    if (target === undefined) {
      throw new Error(
        "SLACK_NOTIFY_CHANNEL is not set, so the digest has nowhere to go."
      );
    }
    const slackToken = await getToken(env.SLACK_CONNECTOR, {
      subject: { type: "app" },
    });
    const outcome = await runDigest(
      {
        alreadyPosted: (key, oldest) =>
          hasKeyedMessage({
            key: { eventType: DIGEST_EVENT_TYPE, key },
            oldest,
            target,
            token: slackToken,
          }),
        installedRepositories: async () => {
          const repositories = await listInstalledRepositories(
            await mintInstallationToken()
          );
          return repositories.map(({ fullName }) => fullName);
        },
        listOpenPullRequests: async (query) =>
          listOpenPullRequests({
            query,
            token: await mintInstallationToken(),
          }),
        now: () => new Date(),
        post: async (text, key) => {
          const delivery = await postKeyedText({
            key: { eventType: DIGEST_EVENT_TYPE, key },
            target,
            text,
            token: slackToken,
          });
          if (!delivery.ok) {
            throw new Error(`The digest was not delivered: ${delivery.error}`);
          }
        },
      },
      appAuth
    );
    // The text is left out: the log says what the run did, not what it said.
    if (outcome.status === "posted") {
      log.info({
        action: "digest",
        key: outcome.key,
        status: outcome.status,
        truncated: outcome.truncated,
        ...outcome.counts,
      });
    } else if (outcome.status === "duplicate") {
      log.info({ action: "digest", key: outcome.key, status: outcome.status });
    } else {
      log.info({ action: "digest", status: outcome.status });
    }
  },
});
