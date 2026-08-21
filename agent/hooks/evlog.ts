import type { EvlogEveOptions } from "evlog/eve";
import { defineEvlogHook } from "evlog/eve";
import { createFsDrain } from "evlog/fs";
import type { PostHogConfig } from "evlog/posthog";
import { createPostHogDrain } from "evlog/posthog";

import type { DrainDestination } from "#lib/drains";
import { createFanOutDrain } from "#lib/drains";
import { env } from "#lib/env";
import { TURN_EVENT } from "#lib/usage";

/**
 * One evlog wide event per turn: who called, on which channel, how many tokens
 * it took, which tools ran, and how it ended.
 *
 * @remarks
 * eve's own Agent Runs already show a turn in the Vercel dashboard, and this
 * does not replace them. What it adds is a record the agent can read back: the
 * model answers through a gateway of the operator's choosing, so nothing
 * upstream knows what a token costs here, and the weekly `cost-watchdog` sweep
 * has no source but the one this hook writes.
 *
 * `message: "omit"` is evlog's default and stays. A turn carries issue bodies,
 * comments, and Slack messages other people wrote, so the event records the
 * shape of a turn (counts, durations, tool names, outcome) and never its
 * content. The identity is `eve.caller.principalId`, a GitHub or Slack id
 * rather than a name or an address; evlog records neither `subject` nor
 * `attributes`, which is where a channel would put those.
 */

/** The PostHog destination, configured from this agent's own environment. */
const posthogDrain = (apiKey: string) => {
  const config: PostHogConfig = {
    apiKey,
    // Cost and volume group by whoever triggered the turn.
    distinctIdField: "eve.caller.principalId",
    eventName: TURN_EVENT,
    // Events rather than logs: at this volume the per-GB saving is irrelevant,
    // and only an event can be charted, alerted on, and queried back by the
    // weekly report.
    mode: "events",
    // Dotted keys, which is what the PostHog UI filters and breaks down by; a
    // nested object is one opaque property there.
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- adapter option name
    recordShape: "compact",
  };
  if (env.POSTHOG_HOST) {
    config.host = env.POSTHOG_HOST;
  }
  return createPostHogDrain(config);
};

const destinations: DrainDestination[] = [];
// The filesystem drain is for `eve dev`: Vercel's filesystem is read-only
// outside /tmp, and the adapter disables itself there after one warning, so a
// deployed build leaves it out rather than letting it fail quietly.
if (!process.env.VERCEL) {
  destinations.push(createFsDrain());
}
if (env.POSTHOG_API_KEY) {
  destinations.push(posthogDrain(env.POSTHOG_API_KEY));
}

const options: EvlogEveOptions = {
  init: {
    env: { service: "baymi" },
    // Pretty-printing is for a terminal, and production has none.
    pretty: !process.env.VERCEL,
  },
  // One extra event per session, rolling its turns up, so a week reads per
  // session as well as per turn.
  sessionEvent: true,
};
const drain = createFanOutDrain(destinations);
if (drain) {
  options.drain = drain;
}
if (env.MODEL_COST_PER_MTOK) {
  options.cost = { [env.MODEL]: env.MODEL_COST_PER_MTOK };
}

export default defineEvlogHook(options);
