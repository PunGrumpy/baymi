import { z } from "zod";

import type { FetchLike } from "#lib/github/installation";

/**
 * Which versions of a package a repository uses, and which version the
 * published advisories say fixes them.
 *
 * @remarks
 * Both answers come from GitHub. The dependency graph's SBOM lists every
 * package the repository resolves, with a package URL (purl) per entry, and
 * the global advisory database answers which advisories affect one version.
 * Neither needs a permission beyond Contents read, and neither sends a
 * package name anywhere but GitHub.
 */

const GITHUB_API = "https://api.github.com";

/**
 * purl types mapped to the ecosystem names GitHub's advisory database uses.
 * A type missing here has no advisories on GitHub.
 */
const ADVISORY_ECOSYSTEMS = {
  cargo: "rust",
  composer: "composer",
  gem: "rubygems",
  githubactions: "actions",
  golang: "go",
  hex: "erlang",
  maven: "maven",
  npm: "npm",
  nuget: "nuget",
  pub: "pub",
  pypi: "pip",
  swift: "swift",
} as const satisfies Readonly<Record<string, string>>;

const isPurlType = (type: string): type is keyof typeof ADVISORY_ECOSYSTEMS =>
  Object.hasOwn(ADVISORY_ECOSYSTEMS, type);

const PURL = /^pkg:(?<type>[a-z]+)\/(?<path>[^?#]+)$/u;

/** One resolved package, read from a purl. */
export interface ResolvedPackage {
  /** The advisory database's ecosystem name. */
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string;
}

/**
 * Reads `pkg:<type>/<namespace>/<name>@<version>` into the name and
 * ecosystem the advisory database uses, or `null` for a purl it does not
 * cover.
 *
 * @remarks
 * Maven names are `group:artifact` in the advisory database, so its segments
 * join with a colon; every other ecosystem joins them with a slash, which
 * keeps `@scope/name` for npm and the module path for Go.
 */
export const parsePurl = (purl: string): ResolvedPackage | null => {
  const match = PURL.exec(purl.split(/[?#]/u)[0] ?? "");
  const type = match?.groups?.type ?? "";
  const path = match?.groups?.path ?? "";
  const at = path.lastIndexOf("@");
  if (!isPurlType(type) || at <= 0) {
    return null;
  }
  const ecosystem = ADVISORY_ECOSYSTEMS[type];
  const segments = path.slice(0, at).split("/").map(decodeURIComponent);
  const version = decodeURIComponent(path.slice(at + 1));
  const name = segments.join(type === "maven" ? ":" : "/");
  return name && version ? { ecosystem, name, version } : null;
};

/** The part of the dependency graph's SBOM this reads. */
export const SBOM = z.object({
  sbom: z.object({
    packages: z.array(
      z.object({
        externalRefs: z
          .array(
            z.object({
              referenceLocator: z.string(),
              referenceType: z.string(),
            })
          )
          .default([]),
      })
    ),
  }),
});

export type Sbom = z.infer<typeof SBOM>;

/**
 * Every version of `packageName` the SBOM lists, deduplicated.
 *
 * @remarks
 * A lockfile can hold one package at several versions, one per dependent,
 * and each can carry different advisories. They are all returned.
 */
export const versionsInSbom = (
  sbom: Sbom,
  packageName: string
): readonly ResolvedPackage[] => {
  const seen = new Map<string, ResolvedPackage>();
  for (const entry of sbom.sbom.packages) {
    for (const ref of entry.externalRefs) {
      if (ref.referenceType !== "purl") {
        continue;
      }
      const resolved = parsePurl(ref.referenceLocator);
      if (resolved?.name === packageName) {
        seen.set(`${resolved.ecosystem}@${resolved.version}`, resolved);
      }
    }
  }
  return [...seen.values()];
};

const splitVersion = (version: string) => {
  const [release = "", prerelease] = version.replace(/^v/u, "").split("-", 2);
  return { parts: release.split(".").map(Number), prerelease };
};

/** `-1`, `0` or `1`, comparing two versions numerically, part by part. */
export const compareVersions = (left: string, right: string): number => {
  const a = splitVersion(left);
  const b = splitVersion(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === undefined) {
    return 1;
  }
  if (b.prerelease === undefined) {
    return -1;
  }
  return a.prerelease < b.prerelease ? -1 : 1;
};

const RANGE_CLAUSE = /^(?<operator>>=|<=|>|<|=)?\s*(?<bound>\S+)$/u;

/**
 * Whether a version falls in an advisory range as GitHub writes them:
 * comma-separated clauses such as `>= 8.0.0, < 8.10.2`, `< 6.28.1` or
 * `= 1.2.3`, all of which must hold. An empty or unreadable range holds
 * nothing.
 */
export const isInRange = (version: string, range: string): boolean => {
  const clauses = range
    .split(",")
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length === 0) {
    return false;
  }
  return clauses.every((clause) => {
    const match = RANGE_CLAUSE.exec(clause);
    const bound = match?.groups?.bound;
    if (bound === undefined) {
      return false;
    }
    const order = compareVersions(version, bound);
    switch (match?.groups?.operator ?? "=") {
      case ">=": {
        return order >= 0;
      }
      case "<=": {
        return order <= 0;
      }
      case ">": {
        return order > 0;
      }
      case "<": {
        return order < 0;
      }
      default: {
        return order === 0;
      }
    }
  });
};

/** One advisory, cut to what a pull request body cites. */
export interface Advisory {
  readonly cve: string | null;
  readonly firstPatchedVersion: string | null;
  readonly ghsa: string;
  readonly severity: string;
  readonly summary: string;
  readonly url: string;
  readonly vulnerableRange: string;
}

const ADVISORIES = z.array(
  z.object({
    cve_id: z.string().nullable(),
    ghsa_id: z.string(),
    html_url: z.string(),
    severity: z.string(),
    summary: z.string(),
    vulnerabilities: z
      .array(
        z.object({
          first_patched_version: z.string().nullable(),
          package: z.object({ ecosystem: z.string(), name: z.string() }),
          vulnerable_version_range: z.string().nullable(),
        })
      )
      .default([]),
  })
);

type ParsedAdvisory = z.infer<typeof ADVISORIES>[number];

/** Advisories per page; also the most the API returns at once. */
const ADVISORY_PAGE_SIZE = 100;

/** How many packages go into one `affects` filter. */
const PACKAGES_PER_QUERY = 100;

/** Pages read per query; a lockfile churn that needs more is not a review. */
const MAX_ADVISORY_PAGES = 5;

/**
 * The advisory as it applies to one installed version, or nothing when no
 * range of it holds that version.
 *
 * @remarks
 * One advisory carries a range per release line (`>= 7.11.0, < 7.29.1` and
 * `>= 8.0.0, < 8.10.2`), each with its own patch. Only the range that holds
 * the version in use says which patch fixes it.
 */
const applyTo = (
  advisory: ParsedAdvisory,
  resolved: { readonly name: string; readonly version: string }
): readonly Advisory[] => {
  const vulnerability = advisory.vulnerabilities.find(
    (candidate) =>
      candidate.package.name === resolved.name &&
      isInRange(resolved.version, candidate.vulnerable_version_range ?? "")
  );
  if (vulnerability === undefined) {
    return [];
  }
  return [
    {
      cve: advisory.cve_id,
      firstPatchedVersion: vulnerability.first_patched_version,
      ghsa: advisory.ghsa_id,
      severity: advisory.severity,
      summary: advisory.summary,
      url: advisory.html_url,
      vulnerableRange: vulnerability.vulnerable_version_range ?? "",
    },
  ];
};

/** One page of the global advisory database, filtered to these packages. */
const advisoryPage = async (input: {
  readonly affects: readonly string[];
  readonly ecosystem: string;
  readonly fetchImpl: FetchLike;
  readonly page: number;
  readonly token: string;
}): Promise<readonly ParsedAdvisory[]> => {
  const query = new URLSearchParams({
    affects: input.affects.join(","),
    ecosystem: input.ecosystem,
    page: String(input.page),
    per_page: String(ADVISORY_PAGE_SIZE),
  });
  const response = await input.fetchImpl(`${GITHUB_API}/advisories?${query}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} reading advisories.`);
  }
  return ADVISORIES.parse(await response.json());
};

/**
 * The advisories that affect one version of one package, from GitHub's
 * global advisory database.
 */
export const readAdvisories = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly resolved: ResolvedPackage;
  readonly token: string;
}): Promise<readonly Advisory[]> => {
  const { fetchImpl = fetch, resolved, token } = input;
  const advisories = await advisoryPage({
    affects: [`${resolved.name}@${resolved.version}`],
    ecosystem: resolved.ecosystem,
    fetchImpl,
    page: 1,
    token,
  });
  return advisories.flatMap((advisory) => applyTo(advisory, resolved));
};

/**
 * The advisories against many installed packages of one ecosystem, keyed by
 * `name@version`. A package no advisory affects has no key.
 *
 * @remarks
 * The `affects` filter takes a list, so a hundred packages cost one call
 * rather than a hundred. Each advisory is still applied per version through
 * its ranges, because the filter says only that some listed version is
 * affected.
 */
export const readAdvisoriesForPackages = async (input: {
  readonly ecosystem: string;
  readonly fetchImpl?: FetchLike;
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
  }[];
  readonly token: string;
}): Promise<ReadonlyMap<string, readonly Advisory[]>> => {
  const { ecosystem, fetchImpl = fetch, packages, token } = input;
  const found = new Map<string, Advisory[]>();
  for (let start = 0; start < packages.length; start += PACKAGES_PER_QUERY) {
    const chunk = packages.slice(start, start + PACKAGES_PER_QUERY);
    const affects = chunk.map((locked) => `${locked.name}@${locked.version}`);
    for (let page = 1; page <= MAX_ADVISORY_PAGES; page += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- pages are sequential by nature
      const advisories = await advisoryPage({
        affects,
        ecosystem,
        fetchImpl,
        page,
        token,
      });
      for (const advisory of advisories) {
        for (const locked of chunk) {
          const applied = applyTo(advisory, locked);
          if (applied.length > 0) {
            const key = `${locked.name}@${locked.version}`;
            found.set(key, [...(found.get(key) ?? []), ...applied]);
          }
        }
      }
      if (advisories.length < ADVISORY_PAGE_SIZE) {
        break;
      }
    }
  }
  return found;
};

/**
 * The lowest version that every advisory calls patched, or `null` when one
 * of them has no patch.
 *
 * @remarks
 * Each advisory names its own first patched version, and a version has to
 * be at or above all of them to clear every one. An advisory with no patch
 * means no version clears it, and a bump cannot be a fix.
 */
export const fixedVersion = (
  advisories: readonly Advisory[]
): string | null => {
  let highest: string | null = null;
  for (const advisory of advisories) {
    if (advisory.firstPatchedVersion === null) {
      return null;
    }
    if (
      highest === null ||
      compareVersions(advisory.firstPatchedVersion, highest) > 0
    ) {
      highest = advisory.firstPatchedVersion;
    }
  }
  return highest;
};
