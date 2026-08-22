import { defineEval } from "eve/evals";

/**
 * Guards the fix for a failure that reached production on 2026-08-22: two
 * Slack sessions opened with `github__getRepository` and got `Not Found`,
 * because nothing in the prompt said which repositories the agent maintains
 * and it guessed an owner. `agent/instructions/repositories.ts` now names them
 * from `DIGEST_REPOS`.
 *
 * Asks the question directly rather than driving a GitHub call, so it stays in
 * the `fast` tag and needs no connector: what regressed was the prompt, and a
 * prompt is what this reads back.
 */
export default defineEval({
  description:
    "Knows which repositories it maintains, and does not invent an owner for them.",
  tags: ["fast"],
  async test(t) {
    await t.send(
      "Which repositories do you maintain? List them exactly, owner and name."
    );
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        "The response lists at least one repository as `owner/name`, and the owner is a real account name rather than the assistant's own GitHub login `baymiai` or a bare repository name with no owner. It does not claim to maintain repositories beyond the ones it names, and it does not say it has no way to know."
      )
      .atLeast(0.7);
  },
});
