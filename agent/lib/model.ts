/**
 * The effort the agent asks for, named on the request as well as set as
 * `reasoning`.
 *
 * @remarks
 * `reasoning` on its own does not reach this gateway; it becomes a small
 * thinking budget that resolves to the lowest level, which is what every
 * review ran at until 2026-09-12. `docs/notes.md` has the measurements.
 * `thinking` has to be named alongside the effort, because the SDK builds
 * the thinking block from `reasoning` only while no effort is set, and a
 * request carrying no thinking block runs with no thinking at all.
 *
 * `high` is what the gateway runs. thaipass rounds an Anthropic-protocol
 * `xhigh` down to `high` (`apps/proxy/src/anthropic/schema.ts`), so the
 * `xhigh` this used to name never reached a model. `max` is the one level
 * above it, and it is not set here: AI Pass bills credits per request out of
 * a daily allowance, and a review at `max` spends more of it on thinking.
 * `docs/notes.md` has the measurements.
 */
export const EFFORT = "high";

/** What `modelOptions` puts on every request; see {@link EFFORT}. */
export const ANTHROPIC_OPTIONS = {
  effort: EFFORT,
  thinking: { type: "enabled" },
} as const;
