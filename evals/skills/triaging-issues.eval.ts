import { defineEval } from "eve/evals";

export default defineEval({
  description: "Loads the triaging-issues playbook before triaging anything.",
  tags: ["fast"],
  async test(t) {
    await t.send(
      "Go through the open issues on the digest repository and label the ones that look like duplicates."
    );
    t.loadedSkill("triaging-issues");
  },
});
