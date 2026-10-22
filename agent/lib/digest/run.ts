import type { SessionAuthContext } from "eve/context";

import { classifyAll } from "#lib/digest/classify";
import type {
  Classified,
  PullRequestFacts,
  Verdict,
} from "#lib/digest/classify";
import { digestKey } from "#lib/digest/key";
import { renderDigest } from "#lib/digest/render";
import {
  bangkokDate,
  bangkokDayStart,
  digestQuery,
  ownersOf,
} from "#lib/digest/scope";
import { isApp } from "#lib/trust";

/**
 * One weekday digest from end to end, with every outside call passed in.
 *
 * @remarks
 * `agent/schedules/digest.ts` supplies the real GitHub and Slack calls and
 * this supplies the order they happen in, so a test can run the whole digest
 * against fakes, including the case that matters: the same data twice posts
 * once. Nothing here writes to GitHub or to memory. The only side effect is
 * the Slack post, and it is the last step.
 */

/** The `event_type` a digest post is tagged with in Slack. */
export const DIGEST_EVENT_TYPE = "baymi_digest";

export interface DigestDeps {
  /** Whether a digest with this key was posted at or after `oldest` (Unix seconds). */
  readonly alreadyPosted: (key: string, oldest: number) => Promise<boolean>;
  /** The repositories the GitHub App is installed on, as `owner/repo`. */
  readonly installedRepositories: () => Promise<readonly string[]>;
  readonly listOpenPullRequests: (query: string) => Promise<{
    readonly facts: readonly PullRequestFacts[];
    readonly truncated: boolean;
  }>;
  readonly now: () => Date;
  /** Posts the text with the key; resolves once Slack has it. */
  readonly post: (text: string, key: string) => Promise<void>;
}

/** How many pull requests landed in each bucket. */
export interface BucketCounts {
  readonly blocked: number;
  readonly healthy: number;
  readonly "needs-owner": number;
}

export type DigestOutcome =
  | {
      readonly key: string;
      readonly status: "duplicate";
    }
  | {
      readonly counts: BucketCounts;
      readonly key: string;
      readonly status: "posted";
      readonly text: string;
      readonly truncated: boolean;
    }
  | { readonly status: "nothing-installed" };

const inBucket = (
  entries: readonly Classified[],
  bucket: Verdict["bucket"]
): number => entries.filter(({ verdict }) => verdict.bucket === bucket).length;

const countBuckets = (entries: readonly Classified[]): BucketCounts => ({
  blocked: inBucket(entries, "blocked"),
  healthy: inBucket(entries, "healthy"),
  "needs-owner": inBucket(entries, "needs-owner"),
});

/**
 * Builds today's digest and posts it unless this exact one is already out.
 *
 * @remarks
 * Refuses to run as anyone but the app, so a route that somehow reached this
 * code as a person or the reviewer does nothing. The order is: read the
 * pull requests, classify them, compute the key, look for it, and only then
 * post. The duplicate check comes after the GitHub read because the key
 * hashes what was read; a run that already posted costs one search.
 */
export const runDigest = async (
  deps: DigestDeps,
  auth: SessionAuthContext
): Promise<DigestOutcome> => {
  if (!isApp(auth)) {
    throw new Error("The digest runs as the app and as nobody else.");
  }
  const now = deps.now();
  const owners = ownersOf(await deps.installedRepositories());
  if (owners.length === 0) {
    return { status: "nothing-installed" };
  }
  const { facts, truncated } = await deps.listOpenPullRequests(
    digestQuery({ now, owners })
  );
  const entries = classifyAll(facts, { owners });
  const key = digestKey(bangkokDate(now), entries);
  if (await deps.alreadyPosted(key, bangkokDayStart(now))) {
    return { key, status: "duplicate" };
  }
  const text = renderDigest(entries, { owners });
  await deps.post(text, key);
  return {
    counts: countBuckets(entries),
    key,
    status: "posted",
    text,
    truncated,
  };
};
