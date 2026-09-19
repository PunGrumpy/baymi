import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

const DAYS_MS = 24 * 60 * 60 * 1000;

/**
 * How many snapshots Vercel keeps per sandbox. One, because nothing reads an
 * older one, and every snapshot behind it still counts against the plan.
 */
const KEPT_SNAPSHOTS = 1;

/**
 * A session's snapshot outlives its last use by this long, and it is the only
 * bound on how much snapshot storage the project holds. A review takes
 * minutes and a mention on it arrives the same day, so nothing reads one
 * older than that; at seven days the project carried a week of reviews at
 * once, about 150 MB each, and ran the plan out of snapshot storage on
 * 2026-09-20. That fails the build, not a turn.
 */
const SESSION_SNAPSHOT_TTL_MS = DAYS_MS;

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
 * `keepLastSnapshots` bounds what one sandbox keeps, not what the project
 * holds: every session creates its own sandbox, so the total grows by one
 * snapshot per review however low the count is. `snapshotExpiration` is what
 * bounds the total.
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
