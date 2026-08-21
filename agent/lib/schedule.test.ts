import type { SlackChannel } from "eve/channels/slack";
import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import type { MaintenanceRunArgs } from "#lib/schedule";
import { maintenanceRun, SWEEP_PREAMBLE } from "#lib/schedule";

const APP_AUTH: SessionAuthContext = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

/** A channel value carries no behavior a schedule handler reaches into. */
const CHANNEL: SlackChannel = { __kind: "eve:channel", routes: [] };

const CHANNEL_ID = "C0123ABCDEF";

/** One recorded `to(channel, target).send(message, options)` call. */
interface Sent {
  readonly auth: SessionAuthContext;
  readonly channelId: string;
  readonly channel: SlackChannel;
  readonly message: string;
}

/** Drives a run handler, and reports what it sent and whether it waited. */
const fire = (handler: (args: MaintenanceRunArgs) => void) => {
  const sent: Sent[] = [];
  const waited: Promise<unknown>[] = [];
  handler({
    appAuth: APP_AUTH,
    to: (channel, target) => ({
      send: (message, options) => {
        sent.push({
          auth: options.auth,
          channel,
          channelId: target.channelId,
          message,
        });
        return Promise.resolve({ id: "session_test" });
      },
    }),
    waitUntil: (task) => waited.push(task),
  });
  return { sent, waited };
};

describe(maintenanceRun, () => {
  it("sends the task with the sweep preamble, as the app principal", () => {
    const { sent } = fire(
      maintenanceRun(CHANNEL, CHANNEL_ID, "Sweep the repository.")
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toBe(`Sweep the repository.\n\n${SWEEP_PREAMBLE}`);
    expect(sent[0]?.auth).toBe(APP_AUTH);
  });

  it("posts to the channel it was given", () => {
    const { sent } = fire(maintenanceRun(CHANNEL, CHANNEL_ID, "Sweep."));
    expect(sent[0]?.channel).toBe(CHANNEL);
    expect(sent[0]?.channelId).toBe(CHANNEL_ID);
  });

  it("holds the cron task open until the session settles", () => {
    // Without waitUntil the task ends when the handler returns, and the
    // session goes with it: the sweep would simply never deliver.
    const { waited } = fire(maintenanceRun(CHANNEL, CHANNEL_ID, "Sweep."));
    expect(waited).toHaveLength(1);
  });
});
