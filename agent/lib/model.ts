import type { AgentModelOptionsDefinition } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * The model the root agent runs on, a native Anthropic id with dashes.
 *
 * @remarks
 * eve's `anthropic()` rejects an id with a slash, and the gateway's dotted
 * form (`anthropic/claude-opus-5.5`) is not what Anthropic's own API answers
 * to. `GET https://api.anthropic.com/v1/models` listed this id on 2026-10-22.
 */
export const LEAD_MODEL_ID = "claude-opus-5-5";

/**
 * The lead: Claude Opus 5.5, called on Anthropic directly with
 * `ANTHROPIC_API_KEY` from the server environment, with no gateway hop.
 *
 * @remarks
 * It reads the diff, decides which findings are real, and decides whether to
 * hand a fix to the worker, which is the judgment the product is for, so it
 * gets the strongest model and the highest effort.
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
 * Anthropic's own effort setting for the lead. eve's `reasoning` stops at
 * `xhigh`, and this provider option, which wins over it, is how to ask for
 * `max`.
 */
export const LEAD_MODEL_OPTIONS = {
  providerOptions: { anthropic: { effort: "max" } },
} satisfies AgentModelOptionsDefinition;

/**
 * The worker: the remediation subagent's model, still a gateway id.
 *
 * @remarks
 * The worker is meant to be Claude Sonnet 5.5 (`claude-sonnet-5-5`), also
 * direct: its work is a long loop of shell commands, edits and check runs
 * whose pass or fail comes from `run_checks`, not from the model's opinion,
 * so it does not need the lead's judgment and costs about half as much per
 * token. It is not yet, because eve 0.62.0 refuses a provider object from a
 * dynamic subagent, and only a string id is accepted there, which routes
 * through AI Gateway (`docs/notes.md`). Until remediation is restructured
 * this stays the id it has always had, so nothing about that subagent
 * changes.
 */
export const WORKER_MODEL = "moonshotai/kimi-k2.7-code";
