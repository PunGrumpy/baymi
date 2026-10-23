import type { AgentModelOptionsDefinition } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * The model the root agent runs on, a native Anthropic id with dashes.
 *
 * @remarks
 * eve's `anthropic()` rejects an id with a slash, and the gateway's dotted
 * form (`anthropic/claude-opus-5.5`) is not what Anthropic's own API answers
 * to. `GET https://api.anthropic.com/v1/models` listed this id on 2026-10-23.
 */
export const LEAD_MODEL_ID = "claude-opus-5-5";

/**
 * The lead: Claude Opus 5.5, called on Anthropic directly with
 * `ANTHROPIC_API_KEY` from the server environment, with no gateway hop.
 *
 * @remarks
 * It reads the diff, decides which findings are real, and decides whether to
 * hand a failing pull request to the chase subagent, which is the judgment
 * the product is for, so it gets the strongest model. Its effort is
 * {@link LEAD_MODEL_OPTIONS}.
 *
 * Nothing upstream counts a direct model's tokens or cost, so the agents'
 * `limits` are token limits, and the `baymi_turn` events are the record of
 * what a turn used.
 */
export const LEAD_MODEL = anthropic(LEAD_MODEL_ID);

/**
 * The lead's input window, from `max_input_tokens` on Anthropic's
 * `/v1/models`. eve reads a model's window from the AI Gateway catalog, which
 * has no entry for a direct model, so the root agent states it. Compaction
 * triggers on a share of it.
 */
export const LEAD_CONTEXT_WINDOW_TOKENS = 1_000_000;

/**
 * Anthropic's own effort setting for the lead, the only reasoning control the
 * root agent sets.
 *
 * @remarks
 * `high` is the cheapest setting that passed `review/finding-format` when
 * `max`, eve's `reasoning: "xhigh"` and `high` were each run once
 * (`docs/notes.md`): about 1,100 output tokens against `max`'s 21,000.
 * `max` is one word away if a harder diff shows `high` missing findings.
 *
 * It is set here, as a provider option, and the agent does not also set eve's
 * `reasoning`. With a provider effort present, the bundled Anthropic provider
 * skips its `reasoning` mapping, so `reasoning` would do nothing, and with it
 * the `thinking` display it would have sent. The model still thinks, since
 * adaptive thinking cannot be turned off on Opus 5.5, but it sends no
 * thinking text, and an eval reports `reasoningBlockCount: 0`.
 */
export const LEAD_MODEL_OPTIONS = {
  providerOptions: { anthropic: { effort: "high" } },
} satisfies AgentModelOptionsDefinition;
