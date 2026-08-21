import {
  agentBrowserRevalidationKey,
  installAgentBrowser,
} from "@agent-browser/eve/sandbox";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

/**
 * The capture CLI, pinned so a release cannot change what a template holds
 * without the key below changing with it.
 */
const BEFORE_AND_AFTER = "@vercel/before-and-after@0.0.4";

/**
 * Agent sandbox configuration.
 *
 * @remarks
 * Pins the hosted Vercel Sandbox backend for both local development and production, so the
 * same environment runs everywhere. Running locally requires the project to be linked and
 * authenticated to Vercel.
 *
 * `bootstrap` marks `/workspace` safe for git. eve's GitHub channel checks the
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
 * It also installs the capture pair: `agent-browser` for the browser itself,
 * and the `before-and-after` CLI that drives it, which declares agent-browser
 * as a peer dependency. Both land in the template, so a capture costs a
 * download once per template build rather than once per pull request. Only the
 * binaries are installed: the `@agent-browser/eve` extension, which would put
 * `browser__*` tools in every prompt, is deliberately not mounted, because
 * what this agent needs is evidence on a pull request, not a browser to drive.
 *
 * `revalidationKey` is what ties the template to those two versions. Without
 * it a pinned bump would leave every existing template holding the old pair.
 *
 * @see {@link https://vercel.com/docs/sandbox | Vercel Sandbox}
 */
export default defineSandbox({
  backend: vercel(),
  async bootstrap({ use }) {
    const sandbox = await use();
    await sandbox.run({
      command: "git config --global --add safe.directory '/workspace'",
    });
    await installAgentBrowser(sandbox);
    await sandbox.run({ command: `npm install -g ${BEFORE_AND_AFTER}` });
  },
  revalidationKey: () =>
    `baymi-sandbox-v1:${agentBrowserRevalidationKey()}:${BEFORE_AND_AFTER}`,
});
