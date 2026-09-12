import { defineAgent } from "eve";

import { anthropic } from "#lib/anthropic";
import { env } from "#lib/env";

/**
 * The effort the agent asks for, named on the request as well as set as
 * `reasoning`.
 *
 * @remarks
 * `reasoning` on its own does not reach this gateway; it becomes a small
 * thinking budget that resolves to the lowest level, which is what every
 * review ran at until 2026-09-12. `docs/notes.md` has the measurements.
 * `thinking` has to be named alongside the effort, because the SDK builds
 * the thinking block from `reasoning` only while no effort is set, and a
 * request carrying no thinking block runs with no thinking at all.
 */
const EFFORT = "xhigh";

/** What `modelOptions` puts on every request; see {@link EFFORT}. */
const ANTHROPIC_OPTIONS = {
  effort: EFFORT,
  thinking: { type: "enabled" },
} as const;

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget. eve discovers the rest of the
 * agent from the filesystem under `agent/`, so a model swap is an
 * environment change while reasoning and context-window changes are code.
 * `defaultTools: false` is what makes the agent read-only, and
 * ARCHITECTURE.md explains which tools come back and why the rest do not.
 */
export default defineAgent({
  compaction: { thresholdPercent: 0.75 },
  defaultTools: false,
  description:
    "Baymi, a security-minded companion for the repositories it is installed on",
  limits: {
    maxOutputTokensPerSession: 250_000,
  },
  model: anthropic(env.MODEL),
  modelContextWindowTokens: 1_000_000,
  modelOptions: { providerOptions: { anthropic: ANTHROPIC_OPTIONS } },
  reasoning: EFFORT,
});
