import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env";
import { isAutonomous } from "#lib/trust";
import type { ListedPrice } from "#lib/usage";
import {
  openRouterPriceUrl,
  parseListedPrice,
  parseUsage,
  usageDate,
  usageQuery,
} from "#lib/usage";

const DEFAULT_API_HOST = "https://us.posthog.com";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * The model's published price, or null when it could not be read.
 *
 * @remarks
 * The cost in the rows below was computed when each turn happened, from
 * `MODEL_COST_PER_MTOK`. This is where that number came from, read fresh, so a
 * report can say the rate it used is still the listed one, or that it is not.
 * A failure here is not a failed report: the usage stands, and the price is
 * reported as unconfirmed.
 */
const listedPrice = async (slug: string): Promise<ListedPrice | null> => {
  try {
    const response = await fetch(openRouterPriceUrl(slug), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok ? parseListedPrice(await response.json()) : null;
  } catch {
    return null;
  }
};

/**
 * Reads this agent's own turns back out of PostHog, a day and a model at a
 * time.
 *
 * @remarks
 * The write side is `agent/hooks/evlog.ts`, which sends one event per turn.
 * This is the read side, and it exists because nothing else knows what the
 * agent spent: the model answers through a gateway of the operator's choosing,
 * so Vercel reports `costUsd: null` for every run and the AI Gateway reporting
 * API this would otherwise use is not in the picture.
 *
 * Withheld from unattended turns. A triage session runs on text a stranger
 * wrote, and the agent's own spend is not part of answering their issue.
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
            "This agent's own usage from its wide events: turns, input and output tokens, cost in dollars, and failed turns, one row per day and model. Both dates are UTC calendar days; `until` is exclusive. `appliedPricePerMTok` is the price the rows were costed at when each turn happened, and `listedPricePerMTok` is what OpenRouter publishes for the model right now, both in dollars per million tokens: quote the applied one for the period and report the pair when they differ. Cost is zero when no price is configured.",
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
              const rows = parseUsage(await response.json());
              const slug = env.OPENROUTER_MODEL_SLUG;
              const listed = slug ? await listedPrice(slug) : null;
              return {
                appliedPricePerMTok: env.MODEL_COST_PER_MTOK ?? null,
                listedPricePerMTok: listed,
                rows,
                success: true,
              };
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
            appliedPricePerMTok: z
              .object({ input: z.number(), output: z.number() })
              .nullable()
              .optional(),
            error: z.string().optional(),
            listedPricePerMTok: z
              .object({
                input: z.number(),
                output: z.number(),
                provider: z.string(),
              })
              .nullable()
              .optional(),
            rows: z
              .array(
                z.object({
                  costUsd: z.number(),
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
