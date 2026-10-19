import { defineEvalConfig } from "eve/evals";

import { jev } from "./lib/typesafe";

/**
 * The judge is TypeSafe's Jev, eve's default evaluator, called on
 * TypeSafe's API with `TYPESAFE_API_KEY` instead of through AI Gateway.
 *
 * @remarks
 * The AI Gateway free tier refuses `typesafe-ai/jev`, and the free
 * evaluation model it admits, `convaiinnovations/laya-free`, rejected long
 * criteria and scored correct replies low (`docs/notes.md`). Jev is from a
 * different family than the agent's model, so it does not share the agent's
 * blind spots.
 *
 * `maxConcurrency` is 1 because the gateway's free tier allows 5 requests a
 * minute, and four evals at once reached it. One at a time is also what a
 * measurement needs: concurrency is the confound that invalidated two
 * earlier comparisons.
 */
export default defineEvalConfig({
  judge: { model: jev() },
  maxConcurrency: 1,
});
