/**
 * The checks that decide whether a chase's fix is verified, and the commands
 * that run them.
 *
 * @remarks
 * The model edits the code; it does not decide whether the edit works. The
 * subagent's `run_checks` tool runs these commands itself and records the
 * exit codes, and `push_fix` reads the record, not the model's account of
 * it. The first run is the reproduction: it runs on the pull request's head
 * as it is, before any edit, and a fix is only verified against a failure
 * that run saw. A fix the checks did not pass on is never pushed.
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

/** Scripts run as checks when a project defines them, in this order. */
export const CHECK_SCRIPTS = ["typecheck", "check", "lint", "test"] as const;

/**
 * How many times one chase may run the checks: once to reproduce the
 * failure, and once after each of the two code attempts.
 */
export const MAX_CHECK_RUNS = 3;

/** No single command runs longer than this, in seconds. */
export const CHECK_TIMEOUT_SECONDS = 600;

/** How much of a command's output the model and the result get. */
export const OUTPUT_TAIL_CHARACTERS = 3000;

/** The package manager a root's lockfile names, or null when it has none. */
export const detectPackageManager = (
  rootFiles: readonly string[]
): PackageManager | null => {
  const present = new Set(rootFiles);
  return LOCKFILES.find(([file]) => present.has(file))?.[1] ?? null;
};

/**
 * A command's time limit: the per-command cap, or what is left of the
 * chase's sandbox budget when that is less, and never under one second.
 */
export const commandTimeout = (budgetLeftSeconds: number): number =>
  Math.max(1, Math.min(CHECK_TIMEOUT_SECONDS, Math.floor(budgetLeftSeconds)));

/**
 * The install flags per package manager: lifecycle scripts off, so nothing a
 * dependency ships runs at install time, and the lockfile frozen, so an
 * install that would rewrite it fails instead of changing a file the chase
 * might then push. `npm ci` is npm's frozen install; Yarn's is `--immutable`.
 */
const INSTALLS: Readonly<Record<PackageManager, string>> = {
  bun: "bun install --frozen-lockfile --ignore-scripts",
  npm: "npm ci --ignore-scripts",
  pnpm: "pnpm install --frozen-lockfile --ignore-scripts",
  yarn: "yarn install --immutable --mode=skip-build",
};

/** Installs dependencies with lifecycle scripts off and the lockfile frozen. */
export const installCommand = (
  manager: PackageManager,
  timeoutSeconds: number = CHECK_TIMEOUT_SECONDS
): string => `timeout ${timeoutSeconds} ${INSTALLS[manager]}`;

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
 * spend the whole budget.
 */
export const checkCommands = (
  manager: PackageManager,
  scripts: Readonly<Record<string, string>>,
  timeoutSeconds: number = CHECK_TIMEOUT_SECONDS
): readonly CheckCommand[] =>
  CHECK_SCRIPTS.filter((name) => name in scripts).map((name) => ({
    command: `CI=true timeout ${timeoutSeconds} ${manager} run ${name}`,
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
  /**
   * C: the tree id the checks left behind (`TREE_COMMAND`); empty when it
   * could not be taken.
   */
  readonly changeDigest: string;
  readonly results: readonly CheckResult[];
  /**
   * B: the tree id just before the run, which is the clean checkout plus the
   * model's own edits; empty when it could not be taken.
   */
  readonly treeBefore: string;
}

/**
 * Whether a run left the tree different from how it found it: the install or
 * a check rewrote, created or deleted a tracked or non-ignored file. Both
 * trees must have been measured; a run that could not be is not a rewrite
 * but is never verified either.
 */
export const rewrote = (record: CheckRecord | null): boolean =>
  record !== null &&
  record.treeBefore !== "" &&
  record.changeDigest !== "" &&
  record.treeBefore !== record.changeDigest;

/** How many paths a rewrite message names. */
const REWRITTEN_SHOWN = 10;

/**
 * The reason a chase stops when the checks changed files, naming the paths.
 * An empty list means the trees differed but the paths could not be listed.
 */
export const rewriteReason = (paths: readonly string[]): string => {
  const shown = paths.slice(0, REWRITTEN_SHOWN).join(", ");
  const more =
    paths.length > REWRITTEN_SHOWN
      ? ` and ${paths.length - REWRITTEN_SHOWN} more`
      : "";
  const named =
    paths.length === 0
      ? "files the sandbox could not list"
      : `${paths.length} file${paths.length === 1 ? "" : "s"} (${shown}${more})`;
  return `The project's own install or checks rewrote ${named}, so what they passed on is not the change the chase made, and nothing was pushed.`;
};

/** Whether any check in a record failed: a reproduction, on the first run. */
export const reproduced = (record: CheckRecord | null): boolean =>
  record?.results.some((result) => result.exitCode !== 0) ?? false;

/** Whether a fix is verified, and the reasons it is not. */
export interface Verdict {
  readonly reasons: readonly string[];
  readonly verified: boolean;
}

/**
 * Decides whether the change about to be pushed is a verified fix.
 *
 * @remarks
 * Verified means: the first run, on the head as it was (the tree before it
 * is the clean checkout), failed, so there was something to fix and the
 * checks can see it; a later run passed every check; no run's install or
 * checks changed a file; the checkout's baseline commit has not moved; and
 * the tree has not moved since the last run. Every reason is collected
 * rather than stopping at the first, because the result lists them all.
 */
export const fixVerdict = (input: {
  readonly baseline: CheckRecord | null;
  /** A: the baseline commit's tree, taken right after the clean checkout. */
  readonly cleanTree: string;
  readonly currentDigest: string;
  /** The baseline commit's tree now: it moves if code in the sandbox ran `git commit` or `git reset`. */
  readonly headTree: string;
  /** The latest run, or `null` when only the baseline ran. */
  readonly latest: CheckRecord | null;
}): Verdict => {
  const { baseline, cleanTree, currentDigest, headTree, latest } = input;
  const reasons: string[] = [];
  let unmeasured = false;
  if (baseline === null) {
    reasons.push("The failure was never reproduced: the checks never ran.");
  } else if (!reproduced(baseline)) {
    reasons.push(
      "The failure did not reproduce: every check passed on the head as it was."
    );
  } else if (baseline.treeBefore === "" || cleanTree === "") {
    unmeasured = true;
  } else if (baseline.treeBefore !== cleanTree) {
    reasons.push(
      "The failure was reproduced on a tree that was already edited, not on the head as it was."
    );
  }
  if (headTree === "" || headTree !== cleanTree) {
    reasons.push(
      headTree === ""
        ? "The checkout's baseline could not be measured in the sandbox."
        : "The checkout's baseline commit moved."
    );
  }
  for (const record of [baseline, latest]) {
    if (rewrote(record)) {
      reasons.push("The install or the checks rewrote files.");
      break;
    }
  }
  if (latest === null) {
    reasons.push("The checks did not run after the change.");
  } else {
    if (
      latest.changeDigest === "" ||
      latest.treeBefore === "" ||
      currentDigest === ""
    ) {
      unmeasured = true;
    } else if (latest.changeDigest !== currentDigest) {
      reasons.push("The code changed after the checks last ran.");
    }
    if (latest.results.length === 0) {
      reasons.push("The project defines no install or check to run.");
    }
    for (const result of latest.results) {
      if (result.exitCode !== 0) {
        reasons.push(`${result.name} exited with ${result.exitCode}.`);
      }
    }
  }
  if (unmeasured) {
    reasons.push("The change could not be measured in the sandbox.");
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
