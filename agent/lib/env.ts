import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import type { ZodString } from "zod";

import { digestRepos } from "#lib/digest";

const connectorUid = (provider: string): ZodString =>
  z
    .string()
    .regex(
      new RegExp(`^${provider}/[\\w.-]+$`, "u"),
      `expected ${provider}/<name>`
    );

/**
 * The agent's environment, validated once at module load.
 *
 * @remarks
 * Nothing here carries a fallback, deliberately: a defaulted endpoint or
 * connector UID points the agent somewhere plausible but wrong, turning a
 * missing variable into a 401 or an opaque Vercel Connect failure at request
 * time rather than a boot error.
 *
 * `ANTHROPIC_BASE_URL` is what decides which service actually answers: the
 * agent talks the Anthropic wire protocol, but the endpoint behind it need not
 * be Anthropic's own. `ANTHROPIC_API_KEY` is therefore validated as a plain
 * non-empty string rather than an `sk-` key, since a compatible gateway issues
 * tokens in its own shape. The model id itself lives in `agent/agent.ts`.
 *
 * Every variable is parsed on first import, so a misconfigured deployment fails
 * discovery with one report naming every problem, rather than throwing them one
 * at a time from whichever module happened to load first.
 *
 * Each variable is described in `.env.example`; see the README for how to pass
 * `.env` to the CLI, which does not load it during discovery.
 */
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    ANTHROPIC_API_KEY: z.string(),
    ANTHROPIC_BASE_URL: z.url(),
    DIGEST_REPOS: digestRepos,
    DIGEST_SLACK_CHANNEL: z
      .string()
      .regex(/^[CDG][A-Z0-9]{6,}$/u, "expected a Slack conversation ID"),
    EVAL_MODEL: z.string(),
    GITHUB_CONNECTOR: connectorUid("github"),
    LINEAR_CONNECTOR: connectorUid("linear"),
    MODEL: z.string(),
    SLACK_CONNECTOR: connectorUid("slack"),
  },
});
