import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

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
 * @see {@link https://vercel.com/docs/sandbox | Vercel Sandbox}
 */
export default defineSandbox({
  backend: vercel(),
  async bootstrap({ use }) {
    const sandbox = await use();
    await sandbox.run({
      command: "git config --global --add safe.directory '/workspace'",
    });
  },
});
