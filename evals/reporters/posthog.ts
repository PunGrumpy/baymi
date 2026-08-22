import type { EvalReporter } from "eve/evals/reporters";

import { evalEvents } from "#evals/lib/posthog";
import { env } from "#lib/env";

/** PostHog's US ingestion host, which is where a `phc_` key posts by default. */
const US_INGESTION_HOST = "https://us.i.posthog.com";

/**
 * Ships every eval result to PostHog as a `baymi_eval` event.
 *
 * @remarks
 * `eve eval` prints a run and forgets it, and `.eve/evals/` keeps the artifacts
 * on the machine that ran them. Neither answers the question a model swap
 * actually raises: which suite moved, and by how much. That question needs the
 * runs side by side over time, which is what a destination outside the process
 * is for.
 *
 * This is the same trade as `agent/hooks/evlog.ts`: the shape of a run travels
 * and its text does not. `evals/lib/posthog.ts` decides what that means in
 * practice, and holds the line on failed-assertion prose.
 *
 * Results are sent once, from `onRunComplete`, rather than per eval as it
 * finishes. A run that dies halfway has no scores worth comparing, so buffering
 * costs nothing and spends one request instead of one per eval. `--skip-report`
 * suppresses config reporters, which is the local iteration path.
 */
export const PostHog = (apiKey: string): EvalReporter => ({
  onEvalComplete() {
    // Every result is read from the run summary instead; see the remark above.
  },
  async onRunComplete(summary) {
    const batch = evalEvents(summary, {
      // CI names the commit; a local run has none and reports without one.
      commitHash: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
      judgeModel: env.EVAL_MODEL,
      model: env.MODEL,
    });
    if (batch.length === 0) {
      return;
    }
    try {
      const response = await fetch(
        `${env.POSTHOG_HOST ?? US_INGESTION_HOST}/batch/`,
        {
          body: JSON.stringify({ api_key: apiKey, batch }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      if (!response.ok) {
        console.error(
          `[baymi] PostHog refused the eval results: ${response.status}`
        );
      }
    } catch (error) {
      // A reporting failure must not fail the run that produced the results:
      // the scores are already on the console and in `.eve/evals/`.
      console.error("[baymi] could not report eval results to PostHog", error);
    }
  },
  onRunStart() {
    // Nothing to open: the batch endpoint is a single stateless request.
  },
});
