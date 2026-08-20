import { defineDynamic, defineInstructions } from "eve/instructions";

import { loadsOnChannel } from "#lib/instructions";

const MARKDOWN = `# In Linear

Users delegate issues to you or mention you in Linear. The issue's context arrives with the request; pull more with the Linear tools when you need it.

- Do what's asked in the issue's terms: summarize it, dig into linked GitHub issues, add a comment, or update it.
- When asked to send something directly ("send me a summary of this issue"), compose it and deliver it with \`send_slack_dm\`. The session usually tells you the requester's name and email address; use that email to resolve their Slack account unless they name someone else. Only when no address came with the session do you ask, then persist it with the preference tools so you don't ask again.`;

/**
 * Standing rules for Linear Agent Sessions.
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
      loadsOnChannel("linear", ctx.channel.kind)
        ? defineInstructions({ markdown: MARKDOWN })
        : null,
  },
});
