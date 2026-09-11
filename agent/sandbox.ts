import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

const DAYS_MS = 24 * 60 * 60 * 1000;

/**
 * How many snapshots Vercel keeps per sandbox. One, because nothing reads an
 * older one, and every snapshot behind it still counts against the plan.
 */
const KEPT_SNAPSHOTS = 1;

/** A session's snapshot outlives its last use by this long. */
const SESSION_SNAPSHOT_TTL_MS = 7 * DAYS_MS;

/**
 * The template's, longer, because losing it breaks the agent rather than one
 * turn: session creation reads it and cannot rebuild it.
 */
const TEMPLATE_SNAPSHOT_TTL_MS = 30 * DAYS_MS;

/**
 * The sandbox eve checks the repository out into.
 *
 * @remarks
 * The agent never runs code here: `bash` and `write_file` are disabled, so
 * the sandbox is only a filesystem the read tools search. What
 * `bootstrap` sets up is the one thing that filesystem needs. eve's GitHub
 * channel checks the repository out under `/workspace` before the first
 * model call, and git refuses to open a repository whose directory another
 * user owns; eve swallows that failure, so without the `safe.directory`
 * entry a review would run against an empty tree and find nothing.
 *
 * `keepLastSnapshots` is what stops the snapshot count from growing: Vercel
 * prunes nothing by default, and each one is the size of the template.
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
    await sandbox.run({
      command: "git config --global --add safe.directory '/workspace'",
    });
  },
  revalidationKey: () => "baymi-sandbox-v3",
});
