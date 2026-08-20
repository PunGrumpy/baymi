import { defineEval } from "eve/evals";

export default defineEval({
  description: "Answers the question instead of narrating its own process.",
  tags: ["fast"],
  async test(t) {
    await t.send("How should I phrase a request for a reproduction case?");
    t.succeeded();
    t.judge.autoevals
      .closedQA(
        'The response answers directly. It does not open by narrating what it is about to do ("let me check", "I\'ll look into that") and does not restate the question before answering.'
      )
      .atLeast(0.7);
  },
});
