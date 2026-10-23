import { defineAgent } from "eve";

import { MODEL } from "#lib/model";

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget. eve discovers the rest of the
 * agent from the filesystem under `agent/`. The model is a gateway id from
 * `#lib/model`, and eve reads its context window from the gateway catalog.
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
  model: MODEL,
  reasoning: "high",
});
