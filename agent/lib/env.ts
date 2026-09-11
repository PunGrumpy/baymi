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
 * A Slack conversation the agent can post to on its own: a channel (`C`), a
 * private channel (`G`), a direct message (`D`), or a member (`U`/`W`), which
 * opens the DM with that person.
 */
const slackConversation = z
  .string()
  .regex(/^[CDGUW][A-Z0-9]{6,}$/u, "expected a Slack channel or member ID");

/**
 * The agent's environment, validated once at module load.
 *
 * @remarks
 * No required variable here has a fallback. A defaulted endpoint or connector
 * UID points the agent somewhere plausible but wrong, turning a missing
 * variable into a 401 at request time rather than a boot error. Every variable
 * is parsed on first import, so a misconfigured deployment fails discovery
 * with one report naming every problem.
 *
 * `ANTHROPIC_BASE_URL` decides which service answers: the agent speaks the
 * Anthropic wire protocol, but the endpoint need not be Anthropic's own, so
 * `ANTHROPIC_API_KEY` is a plain non-empty string rather than an `sk-` key.
 *
 * The optional variables are the ones whose absence removes a capability
 * rather than breaking one. Without `SLACK_NOTIFY_CHANNEL` the agent still
 * reviews and still answers; what it cannot do is check in on Slack when a
 * review turns up something serious. Without the PostHog key the turn events
 * still print in `eve dev` and simply have nowhere to go.
 *
 * Each variable is described in `.env.example`.
 */
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    ANTHROPIC_API_KEY: z.string(),
    ANTHROPIC_BASE_URL: z.url(),
    EVAL_MODEL: z.string(),
    GITHUB_CONNECTOR: connectorUid("github"),
    GITHUB_WEBHOOK_SECRET: z.string(),
    MODEL: z.string(),
    POSTHOG_API_KEY: z.string().optional(),
    POSTHOG_HOST: z.url().optional(),
    SLACK_CONNECTOR: connectorUid("slack"),
    SLACK_NOTIFY_CHANNEL: slackConversation.optional(),
    SLACK_TEAM_ID: z
      .string()
      .regex(/^[TE][A-Z0-9]{6,}$/u, "expected a Slack team ID")
      .optional(),
  },
});
