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

/** One installed package, as a lockfile records it. */
export interface LockedPackage {
  readonly name: string;
  readonly version: string;
}

/** Every installed package in a text `bun.lock`, each once. */
export const packagesInBunLock = (text: string): readonly LockedPackage[] => {
  const seen = new Map<string, LockedPackage>();
  for (const match of text.matchAll(BUN_ENTRY)) {
    const { name, version } = match.groups ?? {};
    if (
      name !== undefined &&
      version !== undefined &&
      isExactVersion(version)
    ) {
      seen.set(`${name}@${version}`, { name, version });
    }
  }
  return [...seen.values()];
};

/**
 * Every installed package in a `package-lock.json`, from its `packages`
 * map, where each key ends in `node_modules/<name>`. A lockfile that is not
 * JSON lists nothing.
 */
export const packagesInPackageLock = (
  text: string
): readonly LockedPackage[] => {
  let parsed: {
    readonly packages?: Readonly<Record<string, { readonly version?: string }>>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const seen = new Map<string, LockedPackage>();
  for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
    const at = path.lastIndexOf("node_modules/");
    const version = entry.version ?? "";
    if (at === -1 || !isExactVersion(version)) {
      continue;
    }
    const name = path.slice(at + "node_modules/".length);
    seen.set(`${name}@${version}`, { name, version });
  }
  return [...seen.values()];
};

/** Every installed package in a lockfile of either kind. */
export const packagesInLockfile = (
  lockfile: Lockfile,
  text: string
): readonly LockedPackage[] =>
  lockfile === "bun.lock"
    ? packagesInBunLock(text)
    : packagesInPackageLock(text);

const versionsOf = (
  packages: readonly LockedPackage[],
  packageName: string
): readonly string[] =>
  packages
    .filter((locked) => locked.name === packageName)
    .map((locked) => locked.version);

/** Every installed version of `packageName` in a text `bun.lock`. */
export const versionsInBunLock = (
  text: string,
  packageName: string
): readonly string[] => versionsOf(packagesInBunLock(text), packageName);

/** Every installed version of `packageName` in a `package-lock.json`. */
export const versionsInPackageLock = (
  text: string,
  packageName: string
): readonly string[] => versionsOf(packagesInPackageLock(text), packageName);

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
 * One root lockfile at one commit, read raw through the contents API, or
 * `null` when the commit has no such file.
 */
export const readLockfile = async (input: {
  readonly fetchImpl?: TextFetch;
  readonly lockfile: Lockfile;
  readonly repository: string;
  readonly sha: string;
  readonly token: string;
}): Promise<string | null> => {
  const { fetchImpl = fetch, lockfile, repository, sha, token } = input;
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
  return response.ok ? await response.text() : null;
};

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
  const { packageName, ...where } = input;
  for (const lockfile of LOCKFILES) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first lockfile that lists the package wins
    const text = await readLockfile({ ...where, lockfile });
    const versions =
      text === null
        ? []
        : versionsOf(packagesInLockfile(lockfile, text), packageName);
    if (versions.length > 0) {
      return { lockfile, versions };
    }
  }
  return null;
};
