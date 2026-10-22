import type { SessionAuthContext } from "eve/context";
import type { MemoryProvider } from "eve/memory";

import type { TrustContext } from "#lib/trust";
import { memoryAccess } from "#lib/trust";

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

/** The one scope the slot has: the maintainer's document. */
export const MAINTAINER_SCOPE = "maintainer";

/**
 * Which document, if any, this turn recalls.
 *
 * @remarks
 * `null` disables the slot for the turn: eve skips the provider and its
 * tools and never falls back to a shared scope. That is the answer for
 * anyone the trust model gives no memory (`memoryAccess`), and for a
 * deployment with no store (`hasMemoryStore`). The app resolves to the same
 * document as the maintainer, because it reads the maintainer's preferences;
 * what it may not do is write them, which `withMemoryAccess` enforces on the
 * tools the slot offers.
 */
export const memoryScope = (
  auth: SessionAuthContext | null,
  environment: MemoryEnvironment,
  context: TrustContext = {}
): typeof MAINTAINER_SCOPE | null =>
  memoryAccess(auth, context) === "none" || !hasMemoryStore(environment)
    ? null
    : MAINTAINER_SCOPE;

/**
 * A provider whose save and remove tools are offered only to a caller with
 * write access.
 *
 * @remarks
 * eve cannot scope a slot to read-only, but the pieces compose: recall runs
 * from the scope alone, and the tools come from `provider.tools()`, which
 * receives the session's auth. Returning `null` there leaves the turn with
 * recall and no tool that changes the document. File memory has no capture
 * step, so nothing else writes. The check runs again when a stored tool call
 * replays, because eve rebuilds the tool from the same provider.
 */
export const withMemoryAccess = (
  provider: MemoryProvider,
  context: TrustContext = {}
): MemoryProvider => ({
  ...provider,
  tools: async (toolsContext) =>
    memoryAccess(toolsContext.session.auth.current, context) === "write"
      ? ((await provider.tools?.(toolsContext)) ?? null)
      : null,
});
