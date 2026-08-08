import { createAnthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

import { env } from "#lib/env.js";

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  baseURL: env.ANTHROPIC_BASE_URL,
});

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget for Kody, the GitHub maintainer agent; the rest of the
 * agent's surface (channels, connections, extensions, tools, skills, subagents) is discovered from the
 * filesystem under `agent/`. Conversation history is compacted once it reaches 75% of the context
 * window, and the per-session output token limit caps runaway sessions.
 */
export default defineAgent({
  compaction: { thresholdPercent: 0.75 },
  limits: {
    maxOutputTokensPerSession: 20_000,
  },
  model: anthropic("claude-opus-4-8"),
});
