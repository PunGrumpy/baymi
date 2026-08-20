import { defineAgent } from "eve";

import { anthropic } from "#lib/anthropic";
import { env } from "#lib/env";

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget for Baymi, the GitHub maintainer agent;
 * the rest of the agent's surface (channels, connections, extensions, tools,
 * skills, subagents) is discovered from the filesystem under `agent/`.
 * Conversation history is compacted once it reaches 75% of the context window,
 * and the per-session output token limit caps runaway sessions.
 */
export default defineAgent({
  compaction: { thresholdPercent: 0.75 },
  description: "Baymi, the GitHub maintainer agent",
  limits: {
    maxOutputTokensPerSession: 20_000,
  },
  model: anthropic(env.MODEL),
  modelContextWindowTokens: 200_000,
  reasoning: "xhigh",
});
