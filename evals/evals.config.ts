import { typeSafeAi } from "@ai-sdk/typesafe-ai";
import { defineEvalConfig } from "eve/evals";

/**
 * The judge is TypeSafe's Jev, eve's default evaluator, called on
 * TypeSafe's API with `TYPESAFE_AI_API_KEY` instead of through AI Gateway.
 *
 * @remarks
 * The AI Gateway free tier refuses `typesafe-ai/jev`, and the free
 * evaluation model it admits, `convaiinnovations/laya-free`, scored correct
 * replies below the threshold (`docs/notes.md`). Jev is from a different
 * family than the agent's model, so it does not share the agent's blind
 * spots.
 *
 * `maxConcurrency` is 1 because one at a time is what a measurement needs:
 * concurrency is the confound that invalidated two earlier comparisons
 * (`docs/notes.md`). It also began as a rate limit, the gateway free tier's 5
 * requests a minute, which four evals at once reached when the lead ran
 * there. The lead no longer goes through the gateway, so that limit is not
 * why it stays 1.
 *
 * Two tags: `fast` is on every eval, which is what the workflow runs, and
 * `lead` marks the ones that pin what the engineering lead does (quiet when
 * healthy, never merges, Thai to the owner, one memory round trip), so
 * `--tag lead` runs just those. Each is a handful of turns with no review,
 * so a run costs less than the review evals do; the judged ones add a Jev
 * call each.
 */
export default defineEvalConfig({
  judge: { model: typeSafeAi.evaluationModel("jev-latest") },
  maxConcurrency: 1,
});
