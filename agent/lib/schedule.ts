import type { SlackChannel } from "eve/channels/slack";
import type { SessionAuthContext } from "eve/context";

/** What a send resolves to. A sweep never reads it; the promise is the point. */
interface StartedSession {
  readonly id: string;
}

/**
 * The slice of a schedule's handler arguments a maintenance run uses.
 *
 * @remarks
 * Narrower than eve's `ScheduleHandlerArgs`, and the reason is the test: a
 * handler that only needs `to(channel, target).send(...)` can be driven by a
 * plain object, while faking the real argument means faking a whole `Session`.
 * `maintenanceRun` is still checked against `ScheduleRunHandler` where it is
 * used, in each sweep under `agent/schedules/`.
 */
export interface MaintenanceRunArgs {
  readonly appAuth: SessionAuthContext;
  readonly to: (
    channel: SlackChannel,
    target: { readonly channelId: string }
  ) => {
    send: (
      message: string,
      options: { readonly auth: SessionAuthContext }
    ) => Promise<StartedSession>;
  };
  readonly waitUntil: (task: Promise<unknown>) => void;
}

/**
 * Shared preamble for a sweep the agent runs on its own clock. It says what a
 * scheduled turn is, which is not obvious from the inside: nobody typed this
 * request just now, nobody is necessarily reading when it lands, and its reply
 * is the Slack message rather than something to send.
 */
export const SWEEP_PREAMBLE = [
  "This is a scheduled maintenance run on your own clock. Nobody typed this request and nobody is necessarily watching Slack right now.",
  "Your reply is the message posted to the channel; do not send it anywhere yourself. Lead with what you found, not with the fact that a schedule fired.",
  "Report honestly when a sweep turns up nothing: one line saying what you checked and that it was clean beats a padded report, and it is what makes the next one worth reading.",
].join("\n\n");

/**
 * A schedule handler that starts one Slack session with `task`, prefixed by
 * {@link SWEEP_PREAMBLE}.
 *
 * @remarks
 * Every sweep delivers the way the weekly digest does: the session starts on
 * the Slack channel, the agent's final message is what lands there, and a
 * reply in that thread resumes the session through the channel's
 * subscribed-thread policy. A sweep is therefore not a report that ends, it is
 * the start of a conversation about what it found.
 *
 * A send with no thread joins no continuation, so each run gets a thread of its
 * own. That is what keeps two sweeps from talking over each other, and it is
 * why these prompts carry no "ignore the earlier conversation" instruction:
 * there is no earlier conversation to ignore.
 *
 * The channel id is passed in rather than read here, so this module stays free
 * of `#lib/env` and its test needs no environment. Every sweep posts to
 * `DIGEST_SLACK_CHANNEL` today; giving maintenance a channel of its own is one
 * variable and one line per sweep, not a redesign.
 */
export const maintenanceRun =
  (channel: SlackChannel, channelId: string, task: string) =>
  ({ appAuth, to, waitUntil }: MaintenanceRunArgs) => {
    waitUntil(
      to(channel, { channelId }).send(`${task}\n\n${SWEEP_PREAMBLE}`, {
        auth: appAuth,
      })
    );
  };
