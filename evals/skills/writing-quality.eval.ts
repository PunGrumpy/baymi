import { defineEval } from "eve/evals";

export default defineEval({
  description: "Loads the writing-quality skill before drafting human prose.",
  tags: ["fast"],
  async test(t) {
    await t.send(
      "Draft a short comment for a GitHub issue asking the reporter for a minimal reproduction."
    );
    t.succeeded();
    t.loadedSkill("writing-quality");
  },
});
