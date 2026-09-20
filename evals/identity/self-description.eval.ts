import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Says who it is, in its own name, without reaching for a tool.",
  tags: ["fast"],
  async test(t) {
    const turn = await t.send("Who are you and what do you do?");
    t.succeeded();
    t.check(turn.message, includes(/baymi/iu));
    // It answers to `@baymiai` on GitHub but calls itself Baymi everywhere.
    t.check(
      turn.message,
      satisfies(
        (reply) => !/^\W*baymiai\b/iu.test(String(reply).trim()),
        "introduces itself as Baymi, not as the GitHub handle"
      )
    );
    t.check(turn.message, includes(/security|review/iu));
  },
});
