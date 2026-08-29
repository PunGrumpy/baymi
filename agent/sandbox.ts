import {
  agentBrowserRevalidationKey,
  installAgentBrowser,
} from "@agent-browser/eve/sandbox";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import { GIT_IDENTITY_COMMAND } from "#lib/github/identity";

/**
 * The capture CLI, pinned so a release cannot change what a template holds
 * without the key below changing with it.
 */
const BEFORE_AND_AFTER = "@vercel/before-and-after@0.0.4";

/**
 * How many snapshots Vercel keeps per sandbox.
 *
 * @remarks
 * One, because nothing reads an older one. A template restores from its last
 * build, and a session resumes from its last suspend. Every snapshot behind
 * those still counts against the plan's snapshot storage.
 */
const KEPT_SNAPSHOTS = 1;

const DAYS_MS = 24 * 60 * 60 * 1000;

/**
 * How long a session's snapshot outlives its last use.
 *
 * @remarks
 * Vercel counts this from last use, not from creation, so it only retires
 * sessions nobody returned to. It also sets how long a parked turn stays
 * resumable. Nobody answers an approval on day 8.
 */
const SESSION_SNAPSHOT_TTL_MS = 7 * DAYS_MS;

/**
 * The same, for the template every session starts from.
 *
 * @remarks
 * Longer than a session's, because losing it breaks the agent rather than one
 * turn. Session creation reads the template's snapshot and cannot rebuild it,
 * so it throws `SandboxTemplateNotProvisionedError` instead. A month with no
 * turns and no deploys would otherwise leave the next trigger nothing to
 * start from.
 */
const TEMPLATE_SNAPSHOT_TTL_MS = 30 * DAYS_MS;

/**
 * Agent sandbox configuration.
 *
 * @remarks
 * Pins the hosted Vercel Sandbox backend for both local development and production, so the
 * same environment runs everywhere. Running locally requires the project to be linked and
 * authenticated to Vercel.
 *
 * `keepLastSnapshots` on `vercel()` is what stops the snapshot count from
 * growing. Vercel prunes nothing by default. A template rebuild writes a new
 * snapshot and leaves the one it replaced. A session suspend writes another
 * onto a `parentId` chain. Each one is 824 MB, the size of this template with
 * agent-browser in it. Each expires 30 days after its last use.
 * The count reached 31 in 20 days and filled the Hobby quota. The next deploy
 * then failed on a 402 at prewarm, which looks like a build failure and is
 * not one. With the policy set, Vercel deletes the older snapshot as it
 * writes the new one. `bootstrap` raises the expiry on the kept template,
 * which needs to outlive a quiet month.
 *
 * `bootstrap` writes the gitconfig every session commits under. The committer
 * identity comes from `agent/lib/github/identity.ts`: git in a fresh sandbox
 * has none, and the model answers that error by guessing one from its own
 * name, which is how a commit ends up authored by `baymi`, an account that
 * belongs to someone else.
 *
 * It also marks `/workspace` safe for git. eve's GitHub channel checks the
 * repository out there before the first model call of a triggered turn, and git
 * refuses to open a repository whose directory another user owns. eve swallows
 * a failed checkout, so without this the turn continues against an empty tree
 * and `read_file`, `glob`, `grep` and the `shipping-a-change` skill all behave
 * as though the repository had no files in it.
 *
 * Template-scoped rather than `onSession`: the gitconfig it writes is
 * filesystem state every later session inherits, including a sandbox eve
 * recreates from the template after provider loss, which `onSession` does not
 * rerun for.
 *
 * And it installs the capture pair: `agent-browser` for the browser itself,
 * and the `before-and-after` CLI that drives it, which declares agent-browser
 * as a peer dependency. Both land in the template, so a capture costs a
 * download once per template build rather than once per pull request. Only the
 * binaries are installed: the `@agent-browser/eve` extension, which would put
 * `browser__*` tools in every prompt, is deliberately not mounted, because
 * what this agent needs is evidence on a pull request, not a browser to drive.
 *
 * `revalidationKey` is what ties the template to those two versions. Without
 * it a pinned bump would leave every existing template holding the old pair.
 * Its own `vN` stem covers everything else `bootstrap` writes, the gitconfig
 * included: a template built before this identity existed would otherwise go
 * on handing sessions a git with no identity at all.
 *
 * @see {@link https://vercel.com/docs/sandbox | Vercel Sandbox}
 */
export default defineSandbox({
  backend: vercel({
    keepLastSnapshots: { count: KEPT_SNAPSHOTS },
    snapshotExpiration: SESSION_SNAPSHOT_TTL_MS,
  }),
  async bootstrap({ use }) {
    const sandbox = await use({
      keepLastSnapshots: {
        count: KEPT_SNAPSHOTS,
        expiration: TEMPLATE_SNAPSHOT_TTL_MS,
      },
    });
    await sandbox.run({ command: GIT_IDENTITY_COMMAND });
    await sandbox.run({
      command: "git config --global --add safe.directory '/workspace'",
    });
    await installAgentBrowser(sandbox);
    await sandbox.run({ command: `npm install -g ${BEFORE_AND_AFTER}` });
  },
  revalidationKey: () =>
    `baymi-sandbox-v2:${agentBrowserRevalidationKey()}:${BEFORE_AND_AFTER}`,
});
