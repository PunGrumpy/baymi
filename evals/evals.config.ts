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
 * `maxConcurrency` is the default for a whole run. Pass
 * `--max-concurrency 1` when the run is a measurement rather than a check;
 * concurrency is the confound that invalidated two earlier comparisons.
 */
export default defineEvalConfig({
  judge: { model: jev() },
  maxConcurrency: 4,
});
