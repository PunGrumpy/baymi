import { defineAgent } from "eve";

import { anthropic } from "#lib/anthropic";
import { env } from "#lib/env";

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget; the rest of the agent
 * (channels, extension, tools, memory, skills) is discovered from the
 * filesystem under `agent/`. The model id comes from `MODEL` and resolves
 * through the provider in `agent/lib/anthropic.ts`, so a model swap is an
 * environment change while reasoning and context-window changes are code.
 *
 * A security review is one long careful read rather than a conversation, so
 * reasoning stays high and the per-session output cap is what bounds a
 * runaway turn.
 */
export default defineAgent({
  compaction: { thresholdPercent: 0.75 },
  description:
    "Baymi, a security-minded companion for the repositories it is installed on",
  limits: {
    maxOutputTokensPerSession: 250_000,
  },
  model: anthropic(env.MODEL),
  modelContextWindowTokens: 1_000_000,
  reasoning: "xhigh",
});
