import { z } from "zod";

import type { FetchLike } from "#lib/github/installation";
import { readAdvisoriesForPackages } from "#lib/remediation/advisories";
import type { LockedPackage, TextFetch } from "#lib/remediation/lockfile";
import {
  LOCKFILES,
  packagesInLockfile,
  readLockfile,
} from "#lib/remediation/lockfile";

/**
 * The dependencies a pull request adds, and the published advisories against
 * them, read from GitHub's dependency review.
 *
 * @remarks
 * Matching a package version against advisories is a database lookup, and
 * GitHub already does it for every repository with the dependency graph on:
 * `GET /repos/{owner}/{repo}/dependency-graph/compare/{base}...{head}` lists
 * each manifest change with the GitHub advisories (GHSA, which carry the CVE
 * ids) that affect the added version. The lookup stays inside GitHub's API,
 * with the installation token the agent already holds, so the agent fetches
 * no URL and sends no package name to a third party.
 *
 * What the review adds is the part GitHub cannot: whether the code calls the
 * vulnerable path. The model answers that from the checkout.
 *
 * GitHub's dependency graph does not parse `bun.lock`, and it is off on most
 * of the installed repositories (`docs/notes.md`). So when the head commit
 * has a root `bun.lock` or `package-lock.json`, the change is read by
 * comparing that lockfile at the base and the head, and the advisories come
 * from the same global database. GitHub's comparison is the fallback.
 */

const GITHUB_API = "https://api.github.com";

/**
 * `owner/repo`, and nothing a path could be built from. The model supplies
 * the repository, and the value goes into a URL path.
 */
export const REPOSITORY_PATTERN = /^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/u;

/** Enough for a lockfile churn; more than this and the names stop helping. */
const MAX_CLEAN_NAMES = 50;

/** One advisory, cut to what a review cites. */
export interface DependencyAdvisory {
  readonly ghsa: string;
  readonly severity: string;
  readonly summary: string;
  readonly url: string;
}

/** An added dependency with at least one advisory against its version. */
export interface VulnerableDependency {
  readonly advisories: readonly DependencyAdvisory[];
  readonly ecosystem: string;
  readonly manifest: string;
  readonly name: string;
  readonly scope: string;
  readonly version: string;
}

/** What the tool returns when GitHub answered. */
export interface DependencyChanges {
  readonly added: number;
  /** Added dependencies with no advisory, as `name@version`, capped. */
  readonly addedClean: readonly string[];
  readonly available: true;
  readonly removed: number;
  readonly vulnerable: readonly VulnerableDependency[];
}

/** What the tool returns when GitHub would not answer. */
export interface DependencyChangesUnavailable {
  readonly available: false;
  readonly reason: string;
}

const CHANGE = z.object({
  change_type: z.enum(["added", "removed"]),
  ecosystem: z.string(),
  manifest: z.string(),
  name: z.string(),
  scope: z.string().nullish(),
  version: z.string(),
  vulnerabilities: z
    .array(
      z.object({
        advisory_ghsa_id: z.string(),
        advisory_summary: z.string(),
        advisory_url: z.string(),
        severity: z.string(),
      })
    )
    .default([]),
});

const CHANGES = z.array(CHANGE);

const PULL_REQUEST = z.object({
  base: z.object({ sha: z.string() }),
  head: z.object({ sha: z.string() }),
});

/**
 * Splits a manifest diff into the vulnerable additions and the rest.
 *
 * @remarks
 * Removals are counted and dropped: a dependency the change takes out cannot
 * expose anything. A version bump arrives as one removal and one addition, so
 * the new version is judged on its own.
 */
export const summarizeDependencyChanges = (
  changes: readonly z.infer<typeof CHANGE>[]
): DependencyChanges => {
  const added = changes.filter((change) => change.change_type === "added");
  const vulnerable = added
    .filter((change) => change.vulnerabilities.length > 0)
    .map((change) => ({
      advisories: change.vulnerabilities.map((advisory) => ({
        ghsa: advisory.advisory_ghsa_id,
        severity: advisory.severity,
        summary: advisory.advisory_summary,
        url: advisory.advisory_url,
      })),
      ecosystem: change.ecosystem,
      manifest: change.manifest,
      name: change.name,
      scope: change.scope ?? "unknown",
      version: change.version,
    }));
  const addedClean = added
    .filter((change) => change.vulnerabilities.length === 0)
    .map((change) => `${change.name}@${change.version}`)
    .slice(0, MAX_CLEAN_NAMES);
  return {
    added: added.length,
    addedClean,
    available: true,
    removed: changes.length - added.length,
    vulnerable,
  };
};

/**
 * Why GitHub refused, in words the model can repeat to the author.
 *
 * @remarks
 * Dependency review needs the dependency graph, and on a private repository
 * GitHub also requires its paid code security product. A 403 or 404 here is
 * a repository setting, not a fault, and the review goes on without it.
 */
export const unavailableReason = (status: number): string => {
  if (status === 403 || status === 404) {
    return `GitHub answered ${status}: dependency review is off for this repository (it needs the dependency graph, and on a private repository GitHub's code security product).`;
  }
  return `GitHub answered ${status} reading the dependency changes.`;
};

const headers = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
});

/** A lockfile entry in the shape GitHub's comparison answers with. */
const lockedChange = (
  changeType: "added" | "removed",
  locked: LockedPackage,
  manifest: string,
  advisories: readonly {
    readonly ghsa: string;
    readonly severity: string;
    readonly summary: string;
    readonly url: string;
  }[]
): z.infer<typeof CHANGE> => ({
  change_type: changeType,
  ecosystem: "npm",
  manifest,
  name: locked.name,
  scope: "unknown",
  version: locked.version,
  vulnerabilities: advisories.map((advisory) => ({
    advisory_ghsa_id: advisory.ghsa,
    advisory_summary: advisory.summary,
    advisory_url: advisory.url,
    severity: advisory.severity,
  })),
});

/** A locked package's identity: its name and its exact version. */
const lockKey = (locked: LockedPackage): string =>
  `${locked.name}@${locked.version}`;

/**
 * The dependency change between two commits, read from the root lockfile at
 * each, or `null` when the head commit has no npm or Bun lockfile.
 *
 * @remarks
 * A package version in the head's lockfile and not in the base's was added;
 * the reverse was removed. A bump is one of each. A lockfile the base does
 * not have yet counts as empty, so a new lockfile adds everything in it.
 */
export const lockfileChanges = async (input: {
  readonly baseSha: string;
  readonly fetchImpl?: FetchLike;
  readonly headSha: string;
  readonly repository: string;
  readonly textFetchImpl?: TextFetch;
  readonly token: string;
}): Promise<DependencyChanges | null> => {
  const { baseSha, fetchImpl, headSha, repository, textFetchImpl, token } =
    input;
  for (const lockfile of LOCKFILES) {
    const where = { fetchImpl: textFetchImpl, lockfile, repository, token };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first lockfile the head has wins
    const headText = await readLockfile({ ...where, sha: headSha });
    if (headText === null) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- read the base only for the lockfile the head has
    const baseText = await readLockfile({ ...where, sha: baseSha });
    const before = packagesInLockfile(lockfile, baseText ?? "");
    const after = packagesInLockfile(lockfile, headText);
    const beforeKeys = new Set(before.map(lockKey));
    const afterKeys = new Set(after.map(lockKey));
    const added = after.filter((locked) => !beforeKeys.has(lockKey(locked)));
    const removed = before.filter((locked) => !afterKeys.has(lockKey(locked)));
    // oxlint-disable-next-line eslint/no-await-in-loop -- one lookup, for the lockfile that answered
    const advisories = await readAdvisoriesForPackages({
      ecosystem: "npm",
      fetchImpl,
      packages: added,
      token,
    });
    return summarizeDependencyChanges([
      ...removed.map((locked) => lockedChange("removed", locked, lockfile, [])),
      ...added.map((locked) =>
        lockedChange(
          "added",
          locked,
          lockfile,
          advisories.get(lockKey(locked)) ?? []
        )
      ),
    ]);
  }
  return null;
};

/**
 * Reads the dependency changes of one pull request, base to head.
 *
 * @remarks
 * Commit shas rather than branch names, so the answer describes the head the
 * review is reading even if the branch moves. The root lockfile comes first,
 * because GitHub's dependency graph does not parse `bun.lock`; GitHub's own
 * comparison answers for any other project.
 */
export const readDependencyChanges = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly pullRequestNumber: number;
  readonly repository: string;
  readonly textFetchImpl?: TextFetch;
  readonly token: string;
}): Promise<DependencyChanges | DependencyChangesUnavailable> => {
  const {
    fetchImpl = fetch,
    pullRequestNumber,
    repository,
    textFetchImpl,
    token,
  } = input;
  const pullResponse = await fetchImpl(
    `${GITHUB_API}/repos/${repository}/pulls/${pullRequestNumber}`,
    { headers: headers(token) }
  );
  if (!pullResponse.ok) {
    return {
      available: false,
      reason: `GitHub answered ${pullResponse.status} reading ${repository}#${pullRequestNumber}.`,
    };
  }
  const { base, head } = PULL_REQUEST.parse(await pullResponse.json());
  let fromLockfile: DependencyChanges | null;
  try {
    fromLockfile = await lockfileChanges({
      baseSha: base.sha,
      fetchImpl,
      headSha: head.sha,
      repository,
      textFetchImpl,
      token,
    });
  } catch (error) {
    // A lockfile or advisory read that dies mid-call is a failed lookup, not
    // a failed review: the model is told why and goes on without it.
    return {
      available: false,
      reason: `Reading the lockfile changes failed: ${String(error)}`,
    };
  }
  if (fromLockfile !== null) {
    return fromLockfile;
  }
  const compareResponse = await fetchImpl(
    `${GITHUB_API}/repos/${repository}/dependency-graph/compare/${base.sha}...${head.sha}`,
    { headers: headers(token) }
  );
  if (!compareResponse.ok) {
    return {
      available: false,
      reason: unavailableReason(compareResponse.status),
    };
  }
  return summarizeDependencyChanges(
    CHANGES.parse(await compareResponse.json())
  );
};
