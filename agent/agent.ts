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
 *
 * `defaultTools: false` turns eve's optional defaults off, and
 * `agent/tools/` adds back the three the agent keeps: `read_file`,
 * `load_skill`, and `ask_question`. The shell, the file writer, the web
 * tools, the todo list, and self-delegation never appear, which is the
 * read-only rule ARCHITECTURE.md describes.
 */
/**
 * The effort the agent asks for, named on the request as well as set as
 * `reasoning`.
 *
 * @remarks
 * `reasoning` alone does not survive the trip. The AI SDK recognizes no
 * Anthropic model behind `ANTHROPIC_BASE_URL`, so instead of naming the
 * effort it converts `reasoning` into a thinking budget derived from the
 * call's output cap: 3,686 tokens, measured off the wire on 2026-09-12. The
 * gateway has no token figure for a level and reads a budget that small as
 * its lowest one, so every review so far has run at `low` while this file
 * asked for the most. Naming the effort as well puts it on the request as
 * `output_config.effort`, which the gateway prefers over the budget.
 *
 * `thinking` has to be named alongside it. The AI SDK derives the thinking
 * block from `reasoning` only while no effort is set, so asking for the
 * effort on its own drops the block entirely, and a request with no
 * thinking block is one the gateway runs with no thinking at all — the
 * opposite of what this asks for. No budget goes with it on purpose: the
 * effort is what the gateway reads, and a budget larger than the call's
 * output cap is invalid on an endpoint that reads budgets instead.
 */
const EFFORT = "xhigh";

/** What `modelOptions` puts on every request; see {@link EFFORT}. */
const ANTHROPIC_OPTIONS = {
  effort: EFFORT,
  thinking: { type: "enabled" },
} as const;

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
