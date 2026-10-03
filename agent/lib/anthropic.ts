import { createAnthropic } from "@ai-sdk/anthropic";

import { env } from "#lib/env";
import { ANTHROPIC_OPTIONS, EFFORT } from "#lib/model";

/**
 * The model provider, speaking the Anthropic wire protocol at whatever
 * endpoint `ANTHROPIC_BASE_URL` names. Used by the root agent and the eval
 * judge alike, so a gateway change is one variable.
 */
export const anthropic = createAnthropic({
  authToken: env.ANTHROPIC_API_KEY,
  baseURL: env.ANTHROPIC_BASE_URL,
});

/**
 * The model settings every agent in this project runs with: the root agent
 * and the remediation subagent answer through the same gateway, at the same
 * effort. Each names its own model id, so the subagent can run on a cheaper
 * one than the review.
 */
export const modelSettings = (modelId: string) =>
  ({
    model: anthropic(modelId),
    modelOptions: { providerOptions: { anthropic: ANTHROPIC_OPTIONS } },
    reasoning: EFFORT,
  }) as const;
