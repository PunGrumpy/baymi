import { defineEval } from "eve/evals";

export default defineEval({
  description: "Answers directly instead of narrating its own process.",
  tags: ["fast"],
  async test(t) {
    await t.send(
      "What kinds of change do you look at most carefully in a pull request?"
    );
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        'The response answers directly. It does not open by narrating what it is about to do ("let me check", "I\'ll look into that"), does not restate the question, and does not end with an offer to do more.'
      )
      .atLeast(0.7);
  },
});
