import { defineAgent, defineDynamic } from "eve";

import { modelSettings } from "#lib/anthropic";
import { env } from "#lib/env";
import { mayRemediate } from "#lib/trust";

const DESCRIPTION =
  "Fix one vulnerable dependency in one installed repository and open a draft pull request with the result. " +
  "Use it only when a person asks you to fix, bump, or patch a vulnerable package. " +
  "Send the repository as owner/name and the package name; it works out the versions, the advisories and the fix itself, and answers with the pull request link and whether its checks passed.";

/**
 * The remediation subagent, offered only on a turn a person started.
 *
 * @remarks
 * A declared subagent inherits nothing from the root: it has only the tools,
 * instructions and sandbox under this directory. That is the boundary the
 * design rests on (`docs/remediation.md`). It has a shell in a sandbox whose
 * egress reaches the npm registries and nothing else, no GitHub tools, and
 * no connection. Its own tools hold the installation token in the app
 * runtime, read the task from GitHub, and push the result.
 *
 * The resolver runs at `session.started` and `turn.started`, so a review
 * session that a person later joins by mention gets the subagent on that
 * turn, and the unattended review turns before it never see it.
 *
 * It runs on `REMEDIATION_MODEL` when that is set, and on the root's `MODEL`
 * otherwise. `run_checks` verifies its work, so it can run on a cheaper
 * model than the review.
 */
const remediationAgent = () =>
  defineAgent({
    defaultTools: false,
    description: DESCRIPTION,
    limits: { maxOutputTokensPerSession: 150_000 },
    ...modelSettings(env.REMEDIATION_MODEL ?? env.MODEL),
  });

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      mayRemediate(ctx.session.auth.current) ? remediationAgent() : null,
    "turn.started": (_event, ctx) =>
      mayRemediate(ctx.session.auth.current) ? remediationAgent() : null,
  },
});
