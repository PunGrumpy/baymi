import { z } from "zod";

/**
 * The PostHog event name every turn is recorded under.
 *
 * @remarks
 * One name for the whole agent, because the thing being counted is a turn.
 * Anything that distinguishes turns (the channel, the caller, the model) is a
 * property to break down by, not a second event type.
 */
export const TURN_EVENT = "baymi_turn";

const COST_PAIR =
  /^\s*(?<input>\d+(?:\.\d+)?)\s*,\s*(?<output>\d+(?:\.\d+)?)\s*$/u;

/**
 * `MODEL_COST_PER_MTOK`, read as `<input>,<output>` in dollars per million
 * tokens.
 *
 * @remarks
 * The endpoint behind `ANTHROPIC_BASE_URL` is a gateway of the operator's
 * choosing, and nothing in the response says what a token costs there. So the
 * price is configuration: set it and every turn carries `ai.estimatedCost`,
 * leave it unset and the same turns are still counted in tokens. What is not
 * on offer is a guessed price, which would put a number nobody can trace into
 * a weekly report.
 */
export const modelCostPerMTok = z
  .string()
  .transform((value, ctx) => {
    const pair = COST_PAIR.exec(value)?.groups;
    if (!(pair?.input && pair.output)) {
      ctx.addIssue({
        code: "custom",
        message: "expected <input>,<output> in dollars per million tokens",
      });
      return z.NEVER;
    }
    return { input: Number(pair.input), output: Number(pair.output) };
  })
  .pipe(z.object({ input: z.number(), output: z.number() }));

/**
 * Where a model's published price is read from, one model at a time.
 *
 * @remarks
 * The whole `/models` listing is a megabyte of every model OpenRouter carries.
 * The per-model endpoint is about a kilobyte, which is what makes checking the
 * price on every weekly report reasonable rather than a thing to skip.
 */
export const openRouterPriceUrl = (slug: string): string =>
  `https://openrouter.ai/api/v1/models/${slug}/endpoints`;

/** The endpoints payload, as much of it as a price needs. */
interface OpenRouterEndpoints {
  readonly data?: {
    readonly endpoints?: readonly {
      readonly pricing?: {
        readonly completion?: string | number;
        readonly prompt?: string | number;
      };
      readonly provider_name?: string;
    }[];
  };
}

/** A published price in dollars per million tokens, and who publishes it. */
export interface ListedPrice {
  readonly input: number;
  readonly output: number;
  readonly provider: string;
}

const PER_MILLION = 1_000_000;

/**
 * The first endpoint's price, converted from dollars per token to dollars per
 * million tokens.
 *
 * @remarks
 * OpenRouter quotes per token, and every other number in this file is per
 * million, so the conversion happens once, here, rather than being left to the
 * model to do in prose. The first endpoint is the one OpenRouter would route
 * to; a model served by several providers can be priced differently by each,
 * so the provider's name travels with the number instead of being dropped.
 *
 * Returns `null` when the payload carries no usable price, which is the answer
 * for a slug that does not exist: the report then says the price could not be
 * confirmed rather than quoting the configured one as though it had been.
 */
export const parseListedPrice = (
  payload: OpenRouterEndpoints
): ListedPrice | null => {
  const endpoint = payload.data?.endpoints?.[0];
  const input = Number(endpoint?.pricing?.prompt);
  const output = Number(endpoint?.pricing?.completion);
  if (!(Number.isFinite(input) && Number.isFinite(output))) {
    return null;
  }
  return {
    input: input * PER_MILLION,
    output: output * PER_MILLION,
    provider: endpoint?.provider_name ?? "unknown",
  };
};

/** A day of usage for one model, as the report tool returns it. */
export interface UsageRow {
  readonly costUsd: number;
  readonly day: string;
  readonly failedTurns: number;
  readonly inputTokens: number;
  readonly model: string;
  readonly outputTokens: number;
  readonly turns: number;
}

/** `YYYY-MM-DD`, the only shape a report boundary is allowed to take. */
export const usageDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "expected YYYY-MM-DD");

/**
 * The HogQL query behind the usage report: one row per day and model.
 *
 * @remarks
 * Both boundaries are validated as dates before they reach the string, and the
 * event name is a constant, so nothing model-written is interpolated into the
 * query. `ai.costUsd` is what the runtime reported and `ai.estimatedCost` is
 * what the configured price implies; the report prefers the first and falls
 * back to the second, so a deployment with no price still returns rows, with
 * zero in the cost column.
 */
export const usageQuery = (since: string, until: string): string =>
  [
    "SELECT",
    "  toDate(timestamp) AS day,",
    "  coalesce(properties.`ai.model`, properties.`eve.runtime.model`, 'unknown') AS model,",
    "  count() AS turns,",
    "  sum(toFloat(coalesce(properties.`ai.inputTokens`, 0))) AS input_tokens,",
    "  sum(toFloat(coalesce(properties.`ai.outputTokens`, 0))) AS output_tokens,",
    "  sum(toFloat(coalesce(properties.`ai.costUsd`, properties.`ai.estimatedCost`, 0))) AS cost_usd,",
    "  countIf(properties.`eve.phase` = 'failed') AS failed_turns",
    "FROM events",
    `WHERE event = '${TURN_EVENT}'`,
    `  AND timestamp >= toDateTime('${since} 00:00:00')`,
    `  AND timestamp < toDateTime('${until} 00:00:00')`,
    "GROUP BY day, model",
    "ORDER BY day, model",
  ].join("\n");

/** One cell of a PostHog result row: a count, a label, or nothing. */
type QueryCell = string | number | null | undefined;

/** What PostHog's query endpoint answers with: positional rows plus a header. */
interface QueryResponse {
  readonly columns?: readonly string[];
  readonly results?: readonly (readonly QueryCell[])[];
}

/** A cell as a number. An absent or unreadable one counts as zero. */
const number = (cell: QueryCell): number => Number(cell ?? 0) || 0;

/**
 * Turns PostHog's positional result rows into named ones.
 *
 * @remarks
 * The endpoint answers with `results` as bare arrays and `columns` as their
 * header, in query order. Reading them by index against the query above rather
 * than by name is what a later column would silently break, so the column list
 * is checked before any row is read.
 */
export const parseUsage = (payload: QueryResponse): UsageRow[] => {
  const columns = payload.columns ?? [];
  const index = (name: string): number => columns.indexOf(name);
  const day = index("day");
  const model = index("model");
  if (day < 0 || model < 0) {
    throw new Error(
      `The usage query returned columns this report cannot read: ${columns.join(", ") || "none"}.`
    );
  }
  return (payload.results ?? []).map((row) => ({
    costUsd: number(row[index("cost_usd")]),
    day: String(row[day] ?? ""),
    failedTurns: number(row[index("failed_turns")]),
    inputTokens: number(row[index("input_tokens")]),
    model: String(row[model] ?? "unknown"),
    outputTokens: number(row[index("output_tokens")]),
    turns: number(row[index("turns")]),
  }));
};
