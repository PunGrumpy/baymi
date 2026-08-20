import { createAnthropic } from "@ai-sdk/anthropic";

import { env } from "#lib/env";

export const anthropic = createAnthropic({
  authToken: env.ANTHROPIC_API_KEY,
  baseURL: env.ANTHROPIC_BASE_URL,
});
