import { defineTool } from "eve/tools";
import { z } from "zod";

import { budgetLeftMs } from "#lib/chase/budget";
import { stopResult } from "#lib/chase/report";
import { chaseState } from "#lib/chase/state";
import { releaseSandbox } from "#lib/sandbox";

/**
 * Ends a chase that will not push: the failure did not reproduce, the second
 * attempt still fails, the budget is spent, or the project cannot be checked
 * here.
 *
 * @remarks
 * The result is built from the recorded runs (`#lib/chase/report`), with the
 * end of the failing output, so the maintainer sees what broke without
 * rerunning anything. The model supplies only the one-sentence reason. The
 * sandbox is deleted, and nothing runs after it.
 */
export default defineTool({
  description:
    "Stop without pushing and report why: the failure did not reproduce, your second fix still fails, the budget ran out, or the checks cannot run. It answers with the result to report.",
  async execute({ reason }, ctx) {
    const state = chaseState.get();
    if (state.result !== null) {
      return { result: state.result };
    }
    const result = stopResult({
      budgetSpent:
        state.startedAt !== null &&
        budgetLeftMs(state.startedAt, Date.now()) <= 0,
      reason,
      state,
    });
    chaseState.update((current) => ({ ...current, result }));
    if (state.task !== null) {
      await releaseSandbox(() => ctx.getSandbox());
    }
    return { result };
  },
  inputSchema: z.object({
    reason: z
      .string()
      .max(500)
      .describe("One sentence: why the chase stops, and what failed last."),
  }),
});
