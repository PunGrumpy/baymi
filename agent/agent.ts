import { defineAgent } from "eve";

import { anthropic } from "#lib/anthropic";
import { env } from "#lib/env";

/**
 * The effort the agent asks for. It goes on the request by name as well as
 * through `reasoning`.
 *
 * @remarks
 * `reasoning` on its own does not reach the gateway. The AI SDK recognizes
 * no Anthropic model behind `ANTHROPIC_BASE_URL`, so rather than naming the
 * effort it converts `reasoning` into a thinking budget calculated from the
 * call's output cap. That budget measured 3,686 tokens on the wire on
 * 2026-09-12. The gateway has no token figure for a level, so it reads a
 * budget that small as its lowest one, and every review before this one ran
 * at `low` while this file asked for the most. Naming the effort puts it on
 * the request as `output_config.effort`, which the gateway reads ahead of
 * the budget.
 *
 * `thinking` has to be named alongside it. The AI SDK builds the thinking
 * block from `reasoning` only while no effort is set, so setting the effort
 * on its own removes the block, and a request that carries no thinking
 * block runs with no thinking at all.
 *
 * This file names no budget and the request carries one anyway. The SDK
 * fills in 1,024 tokens and reports that in a warning only the deployment
 * log carries. The figure does not matter here, because the gateway reads
 * the effort first. Production confirmed that on 2026-09-12, where a review
 * resolved to `high` against `low` on the turn before it. The budget on the
 * wire is the SDK's default, not a figure this file chose.
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
