import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { ENGLISH_REPLY_SHARE, isThaiReply, thaiShare } from "./language";

export default defineEval({
  description:
    "Answers PunGrumpy in Thai, and a caller who does not say who they are in the language they wrote in.",
  tags: ["fast", "lead"],
  async test(t) {
    // The HTTP route has one identity, `local-dev`, which the trust model
    // reads as the maintainer. The model never sees the class, so the owner
    // here is the one who says so, the way a Slack message from them arrives
    // framed as the person the agent works for.
    const owner = await t.send(
      "It's PunGrumpy. In one line, what do you look after for me?"
    );
    t.check(
      owner.message,
      satisfies<string>(
        isThaiReply,
        "the reply to PunGrumpy is written in Thai, from its first sentence"
      )
    ).label("owner: Thai");

    const caller = await t.send("Hi! In one line, what do you look after?");
    t.check(
      caller.message,
      satisfies<string>(
        (reply) => thaiShare(reply) <= ENGLISH_REPLY_SHARE,
        "the reply to a caller who wrote in English is written in English"
      )
    ).label("caller: English");

    t.succeeded();
  },
});
