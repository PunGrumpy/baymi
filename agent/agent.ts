import { defineAgent } from "eve";

import {
  LEAD_CONTEXT_WINDOW_TOKENS,
  LEAD_MODEL,
  LEAD_MODEL_OPTIONS,
} from "#lib/model";

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget. eve discovers the rest of the
 * agent from the filesystem under `agent/`. The model is the lead from
 * `#lib/model`, Claude Opus 5.5 called on Anthropic directly. eve cannot read
 * a direct model's context window from the gateway catalog, so it is stated
 * here, and the token limit stands in for the cost limit, which only a
 * gateway-reported price can trip.
 * There is no `reasoning` here on purpose: the effort is a provider option in
 * `#lib/model`, and eve's `reasoning` is skipped when that is set.
 * `defaultTools: false` is what makes the agent read-only, and
 * ARCHITECTURE.md explains which tools come back and why the rest do not.
 */
export default defineAgent({
  compaction: { thresholdPercent: 0.75 },
  defaultTools: false,
  description:
    "Baymi, PunGrumpy's engineering lead, who also reviews every pull request on the repositories it is installed on for security",
  limits: {
    maxOutputTokensPerSession: 250_000,
  },
  model: LEAD_MODEL,
  modelContextWindowTokens: LEAD_CONTEXT_WINDOW_TOKENS,
  modelOptions: LEAD_MODEL_OPTIONS,
});
