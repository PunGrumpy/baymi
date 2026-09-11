import { createAnthropic } from "@ai-sdk/anthropic";

import { env } from "#lib/env";

/**
 * The model provider, speaking the Anthropic wire protocol at whatever
 * endpoint `ANTHROPIC_BASE_URL` names. Used by the root agent and the eval
 * judge alike, so a gateway change is one variable.
 */
export const anthropic = createAnthropic({
  authToken: env.ANTHROPIC_API_KEY,
  baseURL: env.ANTHROPIC_BASE_URL,
});
