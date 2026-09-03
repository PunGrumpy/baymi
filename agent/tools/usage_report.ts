import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env";
import { isAutonomous } from "#lib/trust";
import { parseUsage, usageDate, usageQuery } from "#lib/usage";

const DEFAULT_API_HOST = "https://us.posthog.com";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Reads this agent's own turns back out of PostHog, a day and a model at a
 * time.
 *
 * @remarks
 * The write side is `agent/hooks/evlog.ts`, which sends one event per turn.
 * This is the read side, and it exists because nothing else knows what the
 * agent ran: the model answers through a gateway of the operator's choosing,
 * so Vercel's Agent Runs see no model usage for these sessions.
 *
 * Withheld from unattended turns. A triage session runs on text a stranger
 * wrote, and the agent's own usage is not part of answering their issue.
 *
 * Resolved per turn rather than once at module load so that configuring
 * PostHog does not need a redeploy to take effect, and so an agent with no
 * PostHog project simply does not carry the tool. It needs both the key and
 * the project id: PostHog's own documentation asks for the numeric id, and the
 * `@current` alias it would otherwise fall back to has no user session to
 * resolve from when the key is scoped to one project.
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const apiKey = env.POSTHOG_PERSONAL_API_KEY;
      const project = env.POSTHOG_PROJECT_ID;
      if (!(apiKey && project) || isAutonomous(ctx.session.auth.current)) {
        return null;
      }
      const host = env.POSTHOG_API_HOST ?? DEFAULT_API_HOST;
      return {
        usage_report: defineTool({
          description:
            "This agent's own usage from its wide events: turns, input and output tokens, and failed turns, one row per day and model. Both dates are UTC calendar days; `until` is exclusive.",
          async execute({ since, until }) {
            const response = await fetch(
              `${host}/api/projects/${project}/query/`,
              {
                body: JSON.stringify({
                  // Top-level, beside `query` rather than inside it: this is
                  // what names the run in PostHog's own query_log, which is
                  // where a slow or rejected query gets identified later.
                  name: "baymi_weekly_usage",
                  query: {
                    kind: "HogQLQuery",
                    query: usageQuery(since, until),
                  },
                }),
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                method: "POST",
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
              }
            );
            if (!response.ok) {
              const body = await response.text();
              return {
                error: `PostHog answered ${response.status}: ${body.slice(0, 400)}`,
                success: false,
              };
            }
            try {
              return { rows: parseUsage(await response.json()), success: true };
            } catch (error) {
              return {
                error:
                  error instanceof Error
                    ? error.message
                    : "The usage query returned something this report cannot read.",
                success: false,
              };
            }
          },
          inputSchema: z.object({
            since: usageDate.describe(
              "First UTC day to include, YYYY-MM-DD, inclusive"
            ),
            until: usageDate.describe(
              "Day to stop at, YYYY-MM-DD, exclusive: pass the day after the last one you want"
            ),
          }),
          outputSchema: z.object({
            error: z.string().optional(),
            rows: z
              .array(
                z.object({
                  day: z.string(),
                  failedTurns: z.number(),
                  inputTokens: z.number(),
                  model: z.string(),
                  outputTokens: z.number(),
                  turns: z.number(),
                })
              )
              .optional(),
            success: z.boolean(),
          }),
        }),
      };
    },
  },
});
