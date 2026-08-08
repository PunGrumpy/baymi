import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import type { ZodString } from "zod";

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
 * Only `RESEND_FROM_NAME` has a default, and it is a real display-name choice
 * rather than a stand-in. Nothing else does, deliberately: a defaulted endpoint
 * or connector UID points the agent somewhere plausible but wrong, turning a
 * missing variable into a 401 or an opaque Vercel Connect failure at request
 * time rather than a boot error.
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
    ANTHROPIC_API_KEY: z.string().startsWith("sk-"),
    ANTHROPIC_BASE_URL: z.url(),
    DIGEST_EMAIL: z.email(),
    DIGEST_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/u, "expected owner/repo"),
    GITHUB_CONNECTOR: connectorUid("github"),
    LINEAR_CONNECTOR: connectorUid("linear"),
    REDIS_URL: z.url(),
    RESEND_API_KEY: z.string().startsWith("re_"),
    RESEND_FROM_ADDRESS: z.email(),
    RESEND_FROM_NAME: z.string().min(1).default("Kody"),
    RESEND_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
    SLACK_CONNECTOR: connectorUid("slack"),
  },
});
