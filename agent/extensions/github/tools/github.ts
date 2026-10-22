import { github } from "@github-tools/eve-extension/tools";
import { defineDynamic } from "eve/tools";

import { toolsForTurn } from "#lib/github/tools";

/**
 * The extension's own tool resolver, with the CI tools taken out on a review
 * turn.
 *
 * @remarks
 * This replaces the extension's `tools/github.ts` slot, which eve documents as
 * the way to adjust a mounted tool ("Override a contribution"). The extension
 * resolves its whole `include` at `step.started` with no per-turn input, so
 * the cut has to happen on what it returns. The tools, their approval
 * policies and their durable callbacks are the extension's own, untouched.
 */
export default defineDynamic({
  events: {
    "step.started": async (event, ctx) => {
      const tools = await github.events["step.started"]?.(event, ctx);
      return tools === undefined
        ? null
        : toolsForTurn(tools, ctx.session.auth.current);
    },
  },
});
