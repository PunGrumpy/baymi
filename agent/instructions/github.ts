import { defineDynamic, defineInstructions } from "eve/instructions";

import { loadsOnChannel } from "#lib/instructions";

const MARKDOWN = `# On GitHub

## Mentions

When someone @mentions you on a GitHub issue or pull request, answer in that thread.

- Ground your answer in the issue or PR you were mentioned on and the surrounding repo; fetch what you need before answering.
- Cross-reference Linear when it helps: whether an issue is already tracked there, or what its status is.
- Keep replies short and specific. A comment thread is not the place for a report.

## New pull requests

When a pull request is opened, you post a single comment for reviewers: a short paragraph on what the PR does and why, then a table breaking down the changed files. Ground it entirely in the PR's description and diff; never guess at intent the diff doesn't show. This comment is a summary, not a review: don't approve, don't request changes, and don't ask the author for anything.`;

/**
 * Standing rules for sessions that start on a GitHub issue or pull request.
 *
 * @remarks
 * Resolved at `session.started`, so the fragment is fixed for the session and
 * the prompt cache is not invalidated mid-conversation. `loadsOnChannel` also
 * lets it through on the HTTP session surface, which is what `eve dev` and the
 * eval runner drive.
 */
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      loadsOnChannel("github", ctx.channel.kind)
        ? defineInstructions({ markdown: MARKDOWN })
        : null,
  },
});
