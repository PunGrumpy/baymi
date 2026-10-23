import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

import { readAgentInfo } from "./info";

export default defineEval({
  description:
    "Saves a preference PunGrumpy states, and recalls it in a later session.",
  tags: ["fast", "lead"],
  async test(t) {
    // Memory is a Vercel Blob document on a deployment, so a run against one
    // would write PunGrumpy's real memory. Only a development server keeps it
    // in process, and `eve eval` boots one.
    const { mode } = await readAgentInfo(t.target);
    if (mode !== "development") {
      t.skip("memory is only in-process on a development server");
    }

    // Not "release pull requests are healthy unless CI fails": the
    // engineering-lead skill already says that, so recalling it would not
    // show the memory worked.
    const told = await t.send(
      'Remember: when I say "ship week", I mean the week before a release, and I only want blockers in the digest that week.'
    );
    told.calledTool("file__save_memory");

    // A new session: nothing of the first conversation is in its context,
    // so only the memory slot can carry the preference over.
    const later = await t.send(
      "What do you remember about how I like things done?"
    );
    t.check(later.message, includes(/ship week/iu)).label("recalls ship week");
    t.judge(
      'The reply says that "ship week" is the week before a release and that the owner wants only blockers in the digest that week. It may say so in Thai or English.',
      { on: later.message }
    )
      .label("recalls the rule")
      .atLeast(0.7);

    // The development store is shared by every eval in the run, so leave
    // it as it was found.
    const forgot = await later.session.send("Forget that one.");
    forgot.calledTool("file__remove_memory").soft();
    t.succeeded();
  },
});
