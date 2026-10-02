import { defineAgent } from "eve";

import { modelSettings } from "#lib/anthropic";

/**
 * Root agent runtime configuration.
 *
 * @remarks
 * Sets the model and the session budget. eve discovers the rest of the
 * agent from the filesystem under `agent/`, so a model swap is an
 * environment change while reasoning and context-window changes are code.
 * The model, its options and the effort come from `modelSettings` in `#lib/anthropic`, which the
 * remediation subagent shares.
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
  modelContextWindowTokens: 1_000_000,
  ...modelSettings(),
});
