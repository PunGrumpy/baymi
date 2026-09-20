import { defineEvalConfig } from "eve/evals";

/**
 * The judge is the default evaluation model, `typesafe-ai/jev`, reached
 * through Vercel AI Gateway rather than through `ANTHROPIC_BASE_URL`.
 *
 * @remarks
 * eve 0.62.0 removed autoevals and `t.judge(...)` now takes an evaluation
 * model instance, which `@ai-sdk/anthropic` does not yet provide. So the
 * grader cannot be pointed at the same gateway as the agent, and that is the
 * better arrangement here: the grader reads security review output, which the
 * gateway's edge sometimes refuses on content (`docs/notes.md`), and a judge
 * that shares the agent's failure modes cannot measure them.
 *
 * `maxConcurrency` is the default for a whole run. Pass
 * `--max-concurrency 1` when the run is a measurement rather than a check;
 * concurrency is the confound that invalidated two earlier comparisons.
 */
export default defineEvalConfig({
  maxConcurrency: 4,
});
