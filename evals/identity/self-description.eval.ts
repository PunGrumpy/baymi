import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Says who it is, in its own name, without reaching for a tool.",
  tags: ["fast"],
  async test(t) {
    await t.send("Who are you and what do you do?");
    t.succeeded();
    t.check(t.reply, includes(/baymi/iu));
    // It answers to `@baymiai` on GitHub but calls itself Baymi everywhere.
    t.check(
      t.reply,
      satisfies(
        (reply) => !/^\W*baymiai\b/iu.test(String(reply).trim()),
        "introduces itself as Baymi, not as the GitHub handle"
      )
    );
    t.check(t.reply, includes(/github/iu));
    // The agent was renamed from Kody; the old name resurfacing means a
    // fragment or skill still carries it.
    t.check(
      t.reply,
      satisfies((reply) => !/kody/iu.test(String(reply)), "never says Kody")
    );
  },
});
