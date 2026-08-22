import { defineEvalConfig } from "eve/evals";

import { PostHog } from "#evals/reporters/posthog";
import { anthropic } from "#lib/anthropic";
import { env } from "#lib/env";

/**
 * The judge that grades `t.judge.*` assertions, resolved once when the runner
 * builds `t` and never used to answer as the agent.
 *
 * @remarks
 * `EVAL_MODEL` is separate from `MODEL` so the grader can be something other
 * than the model under test. Point both at the same id and every judged score
 * becomes a self-assessment, which a model gives itself more readily than an
 * independent grader would; that is worth knowing before reading the numbers.
 *
 * The PostHog reporter is attached here rather than per eval so one run lands
 * as one set of comparable results, and it is attached only when a key exists,
 * the same condition `agent/hooks/evlog.ts` puts on the turn drain: a fresh
 * checkout runs its evals and prints them, it just has nowhere to send them.
 */
export default defineEvalConfig({
  judge: { model: anthropic(env.EVAL_MODEL) },
  maxConcurrency: 4,
  reporters: env.POSTHOG_API_KEY ? [PostHog(env.POSTHOG_API_KEY)] : [],
});
