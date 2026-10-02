import { z } from "zod";

import type { FetchLike } from "#lib/github/installation";
import type { Advisory, ResolvedPackage } from "#lib/remediation/advisories";
import {
  compareVersions,
  fixedVersion,
  readAdvisories,
  SBOM,
  versionsInSbom,
} from "#lib/remediation/advisories";
import type { TextFetch } from "#lib/remediation/lockfile";
import { isExactVersion, versionsInLockfiles } from "#lib/remediation/lockfile";

/**
 * The remediation task, built from GitHub's data rather than from what the
 * model was told.
 *
 * @remarks
 * The model names a repository and a package. Everything else comes from
 * GitHub at the moment the task is resolved: the default branch and its head
 * commit, the versions the dependency graph resolves, the advisories against
 * each, and the version that clears them. The subagent stores the result in
 * durable state, and the tools that push read it from there, so nothing the
 * model reads later can move the work to another repository or commit.
 */

const GITHUB_API = "https://api.github.com";

/** One vulnerable version in use, with what affects it. */
export interface VulnerableVersion {
  readonly advisories: readonly Advisory[];
  readonly version: string;
}

/** Everything the subagent works from. */
export interface RemediationTask {
  readonly baseSha: string;
  readonly defaultBranch: string;
  readonly ecosystem: string;
  /** The lowest version that clears every advisory, or null when none does. */
  readonly fixedVersion: string | null;
  readonly packageName: string;
  readonly repository: string;
  readonly vulnerable: readonly VulnerableVersion[];
}

/** Why there is nothing to remediate, in words the model can repeat. */
export interface TaskRefusal {
  readonly reason: string;
}

const REPOSITORY = z.object({ default_branch: z.string() });
const COMMIT = z.object({ sha: z.string() });

const get = async (
  fetchImpl: FetchLike,
  token: string,
  path: string
): Promise<{ readonly body: unknown; readonly status: number }> => {
  const response = await fetchImpl(`${GITHUB_API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  return response.ok
    ? { body: await response.json(), status: response.status }
    : { body: {}, status: response.status };
};

const vulnerableVersions = async (
  fetchImpl: FetchLike,
  token: string,
  versions: readonly ResolvedPackage[]
): Promise<readonly VulnerableVersion[]> => {
  const results = await Promise.all(
    versions.map(async (resolved) => ({
      advisories: await readAdvisories({ fetchImpl, resolved, token }),
      version: resolved.version,
    }))
  );
  return results.filter((entry) => entry.advisories.length > 0);
};

/**
 * The version to bump to, or `null` when no single release clears every
 * advisory without going backwards.
 *
 * @remarks
 * The patch has to be newer than every version in use. A lower one means
 * the advisories were read against the wrong release line, and pushing it
 * would be a downgrade presented as a fix.
 */
export const upgradeTarget = (
  vulnerable: readonly VulnerableVersion[]
): string | null => {
  const target = fixedVersion(vulnerable.flatMap((entry) => entry.advisories));
  if (target === null) {
    return null;
  }
  return vulnerable.every((entry) => compareVersions(target, entry.version) > 0)
    ? target
    : null;
};

/**
 * The installed versions of the package at the base commit: from the root
 * npm or Bun lockfile when one lists it, from the dependency graph's SBOM
 * otherwise.
 *
 * @remarks
 * The SBOM is the fallback because GitHub does not parse `bun.lock`, and for
 * a Bun project it lists `package.json` ranges instead of installed
 * versions. A range cannot be matched against an advisory, so the SBOM's
 * versions are kept only when they are exact.
 */
const installedVersions = async (input: {
  readonly fetchImpl: FetchLike;
  readonly packageName: string;
  readonly repository: string;
  readonly sha: string;
  readonly textFetchImpl?: TextFetch;
  readonly token: string;
}): Promise<readonly ResolvedPackage[] | TaskRefusal> => {
  const { fetchImpl, packageName, repository, sha, textFetchImpl, token } =
    input;
  const locked = await versionsInLockfiles({
    fetchImpl: textFetchImpl,
    packageName,
    repository,
    sha,
    token,
  });
  if (locked !== null) {
    return locked.versions.map((version) => ({
      ecosystem: "npm",
      name: packageName,
      version,
    }));
  }
  const sbom = await get(
    fetchImpl,
    token,
    `/repos/${repository}/dependency-graph/sbom`
  );
  if (sbom.status !== 200) {
    return {
      reason: `${packageName} is in no root bun.lock or package-lock.json, and GitHub answered ${sbom.status} reading the dependency graph; it may be off for ${repository}.`,
    };
  }
  const parsed = SBOM.safeParse(sbom.body);
  if (!parsed.success) {
    return {
      reason:
        "GitHub's dependency graph answered in a shape this does not read.",
    };
  }
  const listed = versionsInSbom(parsed.data, packageName);
  if (listed.length === 0) {
    return {
      reason: `${packageName} is not in ${repository}'s lockfile or dependency graph.`,
    };
  }
  const exact = listed.filter((resolved) => isExactVersion(resolved.version));
  if (exact.length === 0) {
    return {
      reason: `The dependency graph lists only version ranges for ${packageName} (${listed.map((resolved) => resolved.version).join(", ")}), and no lockfile it reads says what is installed.`,
    };
  }
  return exact;
};

/**
 * Resolves the task for one package on one repository's default branch.
 *
 * @remarks
 * Answers a refusal rather than throwing when there is nothing to do: the
 * package is not in the dependency graph, no version in use has an
 * advisory, or GitHub would not answer. A task whose advisories have no
 * patched version still resolves, with `fixedVersion: null`, so the model can
 * say that no bump fixes it.
 */
export const resolveTask = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly packageName: string;
  readonly repository: string;
  readonly textFetchImpl?: TextFetch;
  readonly token: string;
}): Promise<RemediationTask | TaskRefusal> => {
  const {
    fetchImpl = fetch,
    packageName,
    repository,
    textFetchImpl,
    token,
  } = input;
  const repo = await get(fetchImpl, token, `/repos/${repository}`);
  if (repo.status !== 200) {
    return { reason: `GitHub answered ${repo.status} reading ${repository}.` };
  }
  const { default_branch: defaultBranch } = REPOSITORY.parse(repo.body);
  const head = await get(
    fetchImpl,
    token,
    `/repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`
  );
  if (head.status !== 200) {
    return {
      reason: `GitHub answered ${head.status} reading ${defaultBranch}.`,
    };
  }
  const { sha: baseSha } = COMMIT.parse(head.body);
  const versions = await installedVersions({
    fetchImpl,
    packageName,
    repository,
    sha: baseSha,
    textFetchImpl,
    token,
  });
  if ("reason" in versions) {
    return versions;
  }
  const vulnerable = await vulnerableVersions(fetchImpl, token, versions);
  if (vulnerable.length === 0) {
    return {
      reason: `No advisory affects the versions of ${packageName} in ${repository} (${versions.map((resolved) => resolved.version).join(", ")}).`,
    };
  }
  return {
    baseSha,
    defaultBranch,
    ecosystem: versions[0]?.ecosystem ?? "",
    fixedVersion: upgradeTarget(vulnerable),
    packageName,
    repository,
    vulnerable,
  };
};

/** Whether `resolveTask` answered with a task rather than a refusal. */
export const isTask = (
  result: RemediationTask | TaskRefusal
): result is RemediationTask => "baseSha" in result;
