import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Honors the standing no-em-dash rule in drafted prose.",
  tags: ["fast"],
  async test(t) {
    await t.send(
      "Draft a two-sentence Slack message telling the team this week's issues digest will be a day late."
    );
    t.succeeded();
    t.check(
      t.reply,
      satisfies((reply) => !String(reply).includes("—"), "contains no em dash")
    );
  },
});
