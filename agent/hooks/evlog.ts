import type { EvlogEveOptions } from "evlog/eve";
import { defineEvlogHook } from "evlog/eve";
import { createFsDrain } from "evlog/fs";
import type { PostHogConfig } from "evlog/posthog";
import { createPostHogDrain } from "evlog/posthog";

import type { DrainDestination } from "#lib/drains";
import { createFanOutDrain } from "#lib/drains";
import { env } from "#lib/env";
import { LEAD_MODEL_ID } from "#lib/model";

/** The PostHog event one turn becomes. */
export const TURN_EVENT = "baymi_turn";

/**
 * One evlog wide event per turn: who called, on which channel, how many
 * tokens it took, which tools ran, and how it ended.
 *
 * @remarks
 * `message: "omit"` is evlog's default and stays. A turn includes diffs,
 * comments, and Slack messages other people wrote, so the event records the
 * shape of a turn (counts, durations, tool names, outcome) and never its
 * content. The identity is `eve.caller.principalId`, a GitHub or Slack id
 * rather than a name.
 *
 * The lead model is called on Anthropic directly and eve is never told a
 * price, so this is the only per-turn record of what a week of reviews cost
 * in tokens.
 *
 * `model` names the lead on every event, because eve's `session.started`
 * carries no model id for evlog to read, which left `ai.model` empty
 * (`docs/notes.md`). Cost stays absent on purpose: a rate applied from memory
 * is a number the next report cannot reproduce.
 */
const posthogDrain = (apiKey: string) => {
  const config: PostHogConfig = {
    apiKey,
    distinctIdField: "eve.caller.principalId",
    eventName: TURN_EVENT,
    mode: "events",
    // Dotted keys, which is what the PostHog UI filters and breaks down by.
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
// outside /tmp, so a deployed build leaves it out.
if (!process.env.VERCEL) {
  destinations.push(createFsDrain());
}
if (env.POSTHOG_API_KEY) {
  destinations.push(posthogDrain(env.POSTHOG_API_KEY));
}

const options: EvlogEveOptions = {
  init: {
    env: { service: "baymi" },
    pretty: !process.env.VERCEL,
  },
  model: LEAD_MODEL_ID,
  sessionEvent: true,
};
const drain = createFanOutDrain(destinations);
if (drain) {
  options.drain = drain;
}
export default defineEvlogHook(options);
