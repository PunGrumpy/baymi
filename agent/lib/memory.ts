/**
 * Whether file memory has a store in this environment.
 *
 * @remarks
 * `fileMemory()` picks its backend lazily: process memory under `eve dev`,
 * Vercel Blob on a deployment, and a thrown error when a deployment has no
 * Blob credentials. That error fails the turn, and it failed every Slack
 * turn on the first production deploy because the store had not been
 * provisioned yet. An answer matters more than a remembered preference, so
 * the scope resolves to `null` when there is no store, which disables the
 * slot for that turn instead of failing it, and the agent answers without
 * memory until `eve integration setup file-memory` has run.
 *
 * The variable names are the ones `fileMemory()` itself probes, in the
 * same order: the `EVE_MEMORY_` namespace setup writes, then a generic
 * Blob store attached by hand.
 */
const BLOB_VARIABLES = [
  "EVE_MEMORY_BLOB_READ_WRITE_TOKEN",
  "EVE_MEMORY_BLOB_STORE_ID",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
] as const;

/** The slice of the environment this reads, so a test can supply one. */
export type MemoryEnvironment = Readonly<
  Partial<Record<(typeof BLOB_VARIABLES)[number] | "VERCEL", string>>
>;

export const hasMemoryStore = (environment: MemoryEnvironment): boolean => {
  if (!environment.VERCEL) {
    return true;
  }
  return BLOB_VARIABLES.some((name) => Boolean(environment[name]?.trim()));
};
