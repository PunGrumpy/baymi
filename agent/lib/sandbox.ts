/**
 * Deletes a turn's sandbox when the turn is done with it.
 *
 * @remarks
 * Every session creates its own Vercel sandbox. Hobby includes 15 GB of
 * snapshot storage for the life of the account and 420 GB-hours of
 * provisioned memory a month. When either runs out, Vercel pauses sandbox
 * creation for 30 days, and every review in that time fails.
 *
 * Without a delete, the VM stays provisioned for 30 idle minutes after the
 * reply, and its snapshot stays until `snapshotExpiration`. Deleting the
 * sandbox when the turn ends frees both the memory and the snapshot storage.
 *
 * No later turn reads the deleted sandbox. eve's GitHub channel checks the
 * repository out in `turn.started` on every turn, so the next push or mention
 * gets a new sandbox from the template with the head checked out.
 */

/** The one lifecycle call this needs from eve's `RuntimeSandboxSession`. */
export interface DisposableSandbox {
  readonly delete: () => Promise<void>;
}

export type ReleaseResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false };

/**
 * Deletes the turn's sandbox. Returns a failure result instead of throwing.
 *
 * @remarks
 * A failed delete must not stop the reply from posting, so the caller logs
 * the failure and moves on. If the delete never happens, the
 * `snapshotExpiration` in `agent/sandbox.ts` removes the snapshot a day later.
 *
 * Call this only where the turn already has a sandbox. After a delete,
 * `getSandbox` creates a new sandbox, so a second call creates a sandbox
 * only to delete it.
 */
export const releaseSandbox = async (
  getSandbox: () => Promise<DisposableSandbox>
): Promise<ReleaseResult> => {
  try {
    const sandbox = await getSandbox();
    await sandbox.delete();
    return { ok: true };
  } catch (error) {
    return { error: `sandbox not released: ${String(error)}`, ok: false };
  }
};
