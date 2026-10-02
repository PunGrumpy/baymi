/**
 * The checks that decide whether a remediation is verified, and the commands
 * that run them.
 *
 * @remarks
 * The model edits the code; it does not decide whether the edit works. The
 * subagent's `run_checks` tool runs these commands itself and records the
 * exit codes, and `submit_fix` reads the record, not the model's account of
 * it. A check that did not run makes the fix an unverified mitigation, never
 * a verified one, a rule borrowed from google/mantis, where an unverified
 * patch is incomplete rather than secure.
 */

import { z } from "zod";

/** Package managers the sandbox has a toolchain for. */
export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

/** Lockfiles in the order a project with several is resolved by. */
const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** The ecosystem names, in the advisory database's terms, the sandbox can check. */
export const CHECKABLE_ECOSYSTEMS: ReadonlySet<string> = new Set(["npm"]);

/** Scripts run as checks when a project defines them, in this order. */
export const CHECK_SCRIPTS = ["typecheck", "check", "lint", "test"] as const;

/**
 * How many times one run may call the checks: once after the bump, and once
 * after each of the two code-fix attempts the maintainer allowed.
 */
export const MAX_CHECK_RUNS = 3;

/** No single check runs longer than this, in seconds. */
export const CHECK_TIMEOUT_SECONDS = 600;

/** How much of a command's output the model and the pull request get. */
export const OUTPUT_TAIL_CHARACTERS = 3000;

/** The package manager a root's lockfile names, or null when it has none. */
export const detectPackageManager = (
  rootFiles: readonly string[]
): PackageManager | null => {
  const present = new Set(rootFiles);
  return LOCKFILES.find(([file]) => present.has(file))?.[1] ?? null;
};

/**
 * Installs dependencies with lifecycle scripts off, so a malicious version of
 * a package runs nothing at install time.
 */
export const installCommand = (manager: PackageManager): string =>
  manager === "yarn"
    ? `timeout ${CHECK_TIMEOUT_SECONDS} yarn install --mode=skip-build`
    : `timeout ${CHECK_TIMEOUT_SECONDS} ${manager} install --ignore-scripts`;

const PACKAGE_JSON = z.object({
  scripts: z.record(z.string(), z.string()).default({}),
});

/**
 * The `scripts` of a `package.json`, or none when the file is absent or is
 * not the JSON it should be. A broken manifest is the project's problem, and
 * the checks it would have named simply do not run.
 */
export const readScripts = (
  manifest: string | null
): Readonly<Record<string, string>> => {
  if (manifest === null) {
    return {};
  }
  try {
    return PACKAGE_JSON.safeParse(JSON.parse(manifest)).data?.scripts ?? {};
  } catch {
    return {};
  }
};

/** One check to run: its name and the shell command that runs it. */
export interface CheckCommand {
  readonly command: string;
  readonly name: string;
}

/**
 * The project's own scripts that count as checks, as commands.
 *
 * @remarks
 * `CI=true` keeps test runners such as Vitest and Jest from starting in
 * watch mode, and `timeout` bounds each command so one hung test cannot
 * spend the whole session.
 */
export const checkCommands = (
  manager: PackageManager,
  scripts: Readonly<Record<string, string>>
): readonly CheckCommand[] =>
  CHECK_SCRIPTS.filter((name) => name in scripts).map((name) => ({
    command: `CI=true timeout ${CHECK_TIMEOUT_SECONDS} ${manager} run ${name}`,
    name,
  }));

/** What one check ended with. */
export interface CheckResult {
  readonly exitCode: number;
  readonly name: string;
  readonly output: string;
}

/** The last characters of a command's output, where its failure usually is. */
export const tail = (text: string, max = OUTPUT_TAIL_CHARACTERS): string =>
  text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;

/** The checks as they stood when they last ran. */
export interface CheckRecord {
  /** A digest of the working tree's changes at the time the checks ran. */
  readonly changeDigest: string;
  readonly results: readonly CheckResult[];
}

/** Whether a fix is verified, and the reasons it is not. */
export interface Verdict {
  readonly reasons: readonly string[];
  readonly verified: boolean;
}

/**
 * Decides whether the change about to be pushed is the one the checks
 * passed on.
 *
 * @remarks
 * Every reason is collected rather than stopping at the first, because the
 * pull request lists them all.
 */
export const verdict = (input: {
  readonly currentDigest: string;
  readonly ecosystem: string;
  readonly record: CheckRecord | null;
}): Verdict => {
  const { currentDigest, ecosystem, record } = input;
  const reasons: string[] = [];
  if (!CHECKABLE_ECOSYSTEMS.has(ecosystem)) {
    reasons.push(
      `The sandbox has no toolchain for ${ecosystem}, so no check ran.`
    );
  }
  if (record === null) {
    reasons.push("The checks never ran.");
  } else {
    if (record.changeDigest !== currentDigest) {
      reasons.push("The code changed after the checks last ran.");
    }
    if (record.results.length === 0) {
      reasons.push("The project defines no install or check to run.");
    }
    for (const result of record.results) {
      if (result.exitCode !== 0) {
        reasons.push(`${result.name} exited with ${result.exitCode}.`);
      }
    }
  }
  return { reasons, verified: reasons.length === 0 };
};

/** One file the change touches. */
export interface ChangedPath {
  readonly deleted: boolean;
  readonly path: string;
}

/**
 * Reads `git diff --cached --name-status -z --no-renames` output.
 *
 * @remarks
 * `-z` separates fields with NUL, so a path with a space or a newline in it
 * survives, and `--no-renames` turns a rename into a deletion and an
 * addition, which is what the Git Data API takes.
 */
export const parseNameStatus = (output: string): readonly ChangedPath[] => {
  const fields = output.split("\0").filter((field) => field !== "");
  const changes: ChangedPath[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index] ?? "";
    const path = fields[index + 1] ?? "";
    changes.push({ deleted: status.startsWith("D"), path });
  }
  return changes;
};
