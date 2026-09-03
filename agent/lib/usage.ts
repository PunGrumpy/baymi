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

/** A day of usage for one model, as the report tool returns it. */
export interface UsageRow {
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
 * query.
 */
export const usageQuery = (since: string, until: string): string =>
  [
    "SELECT",
    "  toDate(timestamp) AS day,",
    "  coalesce(properties.`ai.model`, properties.`eve.runtime.model`, 'unknown') AS model,",
    "  count() AS turns,",
    "  sum(toFloat(coalesce(properties.`ai.inputTokens`, 0))) AS input_tokens,",
    "  sum(toFloat(coalesce(properties.`ai.outputTokens`, 0))) AS output_tokens,",
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
    day: String(row[day] ?? ""),
    failedTurns: number(row[index("failed_turns")]),
    inputTokens: number(row[index("input_tokens")]),
    model: String(row[model] ?? "unknown"),
    outputTokens: number(row[index("output_tokens")]),
    turns: number(row[index("turns")]),
  }));
};
