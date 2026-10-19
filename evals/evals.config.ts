import { defineEvalConfig } from "eve/evals";

/**
 * The judge is `convaiinnovations/laya-free`, an evaluation model the AI
 * Gateway free tier admits.
 *
 * @remarks
 * eve's default judge, `typesafe-ai/jev`, answers "Free tier users do not
 * have access to this model" on this account (`docs/notes.md`). The judge
 * has to be an evaluation model, not a language model id, and laya is from
 * a different family than the agent's model, so it does not share the
 * agent's blind spots.
 *
 * `maxConcurrency` is the default for a whole run. Pass
 * `--max-concurrency 1` when the run is a measurement rather than a check;
 * concurrency is the confound that invalidated two earlier comparisons.
 */
export default defineEvalConfig({
  judge: { model: "convaiinnovations/laya-free" },
  maxConcurrency: 4,
});
