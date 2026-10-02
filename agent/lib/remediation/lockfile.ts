/**
 * The installed versions of a package, read from the repository's own npm or
 * Bun lockfile.
 *
 * @remarks
 * GitHub's dependency graph does not parse `bun.lock`. For a Bun project its
 * SBOM lists the `package.json` ranges (`^5.0.1`) rather than what is
 * installed, and an advisory cannot be matched against a range. So for the
 * npm ecosystem the lockfile at the base commit is read first, and the SBOM
 * is the fallback for every other ecosystem (`docs/notes.md`).
 */

const GITHUB_API = "https://api.github.com";

/** Lockfiles read at the repository root, in this order. */
export const LOCKFILES = ["bun.lock", "package-lock.json"] as const;

export type Lockfile = (typeof LOCKFILES)[number];

/** `1.2.3`, with an optional prerelease or build: an installed version. */
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u;

/** Whether a version is one release rather than a range or a tag. */
export const isExactVersion = (version: string): boolean =>
  EXACT_VERSION.test(version);

/**
 * One `packages` entry of a text `bun.lock`: the key, then an array whose
 * first item is `"<name>@<version>"`. A scoped name keeps its leading `@`.
 */
const BUN_ENTRY =
  /^\s*"[^"]+":\s*\["(?<name>(?:@[^@/"]+\/)?[^@"]+)@(?<version>[^"]+)"/gmu;

/** Every installed version of `packageName` in a text `bun.lock`. */
export const versionsInBunLock = (
  text: string,
  packageName: string
): readonly string[] => {
  const versions = new Set<string>();
  for (const match of text.matchAll(BUN_ENTRY)) {
    const { name, version } = match.groups ?? {};
    if (
      name === packageName &&
      version !== undefined &&
      isExactVersion(version)
    ) {
      versions.add(version);
    }
  }
  return [...versions];
};

/**
 * Every installed version of `packageName` in a `package-lock.json`, from
 * its `packages` map, where each key ends in `node_modules/<name>`.
 */
export const versionsInPackageLock = (
  text: string,
  packageName: string
): readonly string[] => {
  let parsed: {
    readonly packages?: Readonly<Record<string, { readonly version?: string }>>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const versions = new Set<string>();
  for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
    const version = entry.version ?? "";
    if (
      path.endsWith(`node_modules/${packageName}`) &&
      isExactVersion(version)
    ) {
      versions.add(version);
    }
  }
  return [...versions];
};

/** The one call this needs, narrowed so a test can supply one. */
export type TextFetch = (
  input: string,
  init: { readonly headers: Readonly<Record<string, string>> }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

/**
 * The versions of `packageName` in the first root lockfile that has it, at
 * one commit, or `null` when no lockfile lists it.
 */
export const versionsInLockfiles = async (input: {
  readonly fetchImpl?: TextFetch;
  readonly packageName: string;
  readonly repository: string;
  readonly sha: string;
  readonly token: string;
}): Promise<{
  readonly lockfile: Lockfile;
  readonly versions: readonly string[];
} | null> => {
  const { fetchImpl = fetch, packageName, repository, sha, token } = input;
  for (const lockfile of LOCKFILES) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first lockfile that lists the package wins
    const response = await fetchImpl(
      `${GITHUB_API}/repos/${repository}/contents/${lockfile}?ref=${sha}`,
      {
        headers: {
          accept: "application/vnd.github.raw",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      }
    );
    if (!response.ok) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- read only the lockfile that answered
    const text = await response.text();
    const versions =
      lockfile === "bun.lock"
        ? versionsInBunLock(text, packageName)
        : versionsInPackageLock(text, packageName);
    if (versions.length > 0) {
      return { lockfile, versions };
    }
  }
  return null;
};
