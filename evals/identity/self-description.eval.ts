import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

import { LEAD_ROLE, SECURITY_REVIEW } from "./phrases";

export default defineEval({
  description:
    "Says who it is, in its own name, as PunGrumpy's engineering lead and security reviewer, without reaching for a tool.",
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
    // The role may be named or described ("leads open pull requests toward
    // merge"), and the security review must still be there. The patterns also
    // accept Thai, since a reply to the owner is in Thai (`./phrases`).
    t.check(turn.message, includes(LEAD_ROLE));
    t.check(turn.message, includes(SECURITY_REVIEW));
  },
});
