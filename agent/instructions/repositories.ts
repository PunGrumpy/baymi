import { defineDynamic, defineInstructions } from "eve/instructions";

import { env } from "#lib/env";
import { repositoriesInstructions } from "#lib/repositories";

/**
 * Which repositories the agent maintains, on every surface.
 *
 * @remarks
 * The only fragment here with no `loadsOnChannel` gate. The others are written
 * for one channel and would be noise on the rest; this one answers "which
 * repository is this about", which every surface that touches GitHub has to
 * answer and only the GitHub channel answers on its own.
 *
 * It is a fragment rather than a section of `instructions.md` because the list
 * is `DIGEST_REPOS`, and prose cannot read an environment variable. Resolved at
 * `session.started` like the others, so it is fixed for the session and does
 * not invalidate the prompt cache mid-conversation.
 */
export default defineDynamic({
  events: {
    "session.started": () =>
      defineInstructions({
        markdown: repositoriesInstructions(env.DIGEST_REPOS),
      }),
  },
});
