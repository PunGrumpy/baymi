/**
 * What a red check was: a flake, a stale base, or the diff's own code.
 *
 * @remarks
 * The table is the `engineering-lead` skill's, applied as code so the answer
 * does not depend on the model's reading of a log. Only the last failing step
 * is read: a job fails once, at the step that exits non-zero, and an earlier
 * step's retried network warning or an action's input says nothing about
 * why. Runner and timeout text there wins first, because the cause is
 * GitHub's. Past that the question is where the failure points.
 *
 * A pull request's checks run on its merge commit, which already holds the
 * base, so a file the diff never touched failing there is not a base the
 * pull request needs to catch up with. Either the diff changed something
 * that file depends on, or the base is red too. So a failure outside the
 * diff asks the base branch's latest run of the same job (`./assess.ts`):
 * red there is a stale base, the base's to fix; green there is the diff's own
 * code; unread is not guessed. The same answer turns a network error in a
 * test the diff changed into a flake only when the base fails the same way:
 * a diff can break the service its own test connects to.
 *
 * Everything the log gives is text a stranger may have written, so nothing
 * here executes or follows it. The evidence line is data for a person to read
 * and is sanitized again where it is rendered (`./line.ts`).
 */

export type FailureKind =
  | "external"
  | "flake"
  | "own-code"
  | "stale-base"
  | "unknown";

/** Why the classifier said what it did. Each is one branch of `classifyFailure`. */
export type FailureReason =
  | "base-unread"
  | "breaks-caller"
  | "external-check"
  | "in-diff"
  | "network"
  | "no-file"
  | "no-log"
  | "outside-diff"
  | "runner"
  | "timeout";

/** The base branch's latest run of the same job: failed, passed, or not read. */
export type BaseVerdict = "green" | "red" | "unknown";

export interface Classification {
  /** Failing files the log named that the diff changed, or all of them when none is in the diff. */
  readonly files: readonly string[];
  readonly kind: FailureKind;
  /** The one log line to show a person, already cleaned. */
  readonly line: string | null;
  readonly reason: FailureReason;
}

/** What the rerun guard and the Slack line each need to read the failure. */
// oxlint-disable-next-line eslint/no-control-regex -- an ANSI escape is a control character
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/gu;

/** `2026-10-22T18:44:39.1234567Z ` ahead of every Actions log line. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/u;

const ANNOTATION_PREFIX = /^##\[(?:error|warning)\]/u;

/** The annotation a failing step, a timeout or a cancel ends with. */
const ERROR_ANNOTATION = /^##\[error\]/u;

const WARNING_ANNOTATION = /^##\[warning\]/u;

/** Where Actions starts a step: `##[group]Run bun install`. */
const STEP_START = /^##\[group\]Run /u;

/** A line that says it was retried or only a warning, so the step carried on past it. */
const SURVIVED = /\bretr(?:y|ying|ies|ied)\b|\bwarn(?:ing)?\b/iu;

const EVIDENCE_MAX = 160;

/** Runner and timeout text first: the cause is GitHub's, not the diff's. */
const RUNNER_PATTERNS: readonly RegExp[] = [
  /runner has received a shutdown signal/iu,
  /hosted runner lost communication/iu,
  /received request to deprovision/iu,
  /no space left on device/iu,
  /failed to download action/iu,
  /the self-hosted runner .* lost/iu,
];

const TIMEOUT_PATTERNS: readonly RegExp[] = [
  /exceeded the maximum execution time/iu,
  /job was canceled because .* (?:timeout|time limit)/iu,
];

const NETWORK_PATTERNS: readonly RegExp[] = [
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE)\b/u,
  /socket hang up/iu,
  /getaddrinfo/iu,
  /could not resolve host/iu,
  /connection (?:reset|timed out|refused)/iu,
  /\bfetch failed\b/iu,
  /tls handshake timeout/iu,
  /rpc failed; curl/iu,
  /unexpected disconnect while reading sideband/iu,
  /\b50[0234] (?:bad gateway|service unavailable|gateway time-?out)/iu,
  /too many requests/iu,
  /npm err! network/iu,
  /error: unable to (?:download|fetch|connect)/iu,
];

/** A line that says something went wrong, as opposed to one that says what ran. */
const ERROR_LINE =
  /error|fail|panic|exception|assert|✗|✖|×|expected|cannot find|not found|unexpected/iu;

/** A stack frame under an error line names the file the error is in. */
const STACK_FRAME = /^(?:at |❯|→)/u;

/** The exit-code line closes every failed step and says nothing about why. */
const EXIT_CODE_LINE = /process completed with exit code \d+/iu;

/** Runners and compilers print these in a fixed case: `FAIL`, `TS2304`. An action's `fail-on-cache-miss: false` input is neither. */
const STRONG_EXACT_CASE = /\bFAIL\b|\bTS\d{4}\b|✗|✖|×/u;

/** The rest, in whatever case a tool chose. */
const STRONG_ANY_CASE = /assertionerror|\bpanic\b|error:|failed/iu;

const isStrong = (line: string): boolean =>
  STRONG_EXACT_CASE.test(line) || STRONG_ANY_CASE.test(line);

/** Lines every failed step ends with. They say a command failed, not what broke. */
const WRAPPER_LINE =
  /exited with code \d+|exited \(\d+\)|^\s*(?:ERROR|Failed:)\s|run failed:|script ".*" exited/u;

const FILE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|mdx|css|scss|yml|yaml|toml|py|go|rs|java|rb|sh|swift|kt|lock";

/** A path with an extension, optionally followed by `:line`, as compilers and test runners print them. */
const FILE_PATH = new RegExp(
  `(/?(?:[\\w@.~+-]+/)*[\\w@.~+-]+\\.(?:${FILE_EXTENSIONS}))(?![\\w-])(?::\\d+)?`,
  "gu"
);

/** Where an Actions runner keeps the checkout; stripped so a path reads like the diff's. */
const RUNNER_WORKSPACE =
  /^(?:\/home\/runner\/work|\/__w|\/github\/workspace)\/[^/]+\/[^/]+\//u;

const IGNORED_PATH =
  /(?:^|\/)(?:node_modules|\.bun|\.cache|\.pnpm)\/|^\/(?:usr|opt|root|home|var|tmp)\//u;

/** A log line without its colour and timestamp, annotation still on. */
const bareLine = (line: string): string =>
  line.replaceAll(ANSI, "").replace(TIMESTAMP, "").trim();

const cleanLine = (line: string): string =>
  bareLine(line).replace(ANNOTATION_PREFIX, "").trim();

const cleanLines = (log: string): readonly string[] =>
  log.split("\n").map(cleanLine);

/** The index of the last line before `end` that `test` accepts, or -1. */
const lastIndex = (
  lines: readonly string[],
  test: (line: string) => boolean,
  end = lines.length
): number => {
  for (let index = end - 1; index >= 0; index -= 1) {
    if (test(lines[index] ?? "")) {
      return index;
    }
  }
  return -1;
};

/**
 * The last failing step of a job's log: from the start of the step the last
 * error annotation sits in, through that annotation. The whole log when it
 * has no annotation, and from its first line when the step started above
 * the tail that was read.
 */
export const lastFailingStep = (log: string): string => {
  const lines = log.split("\n");
  const bare = lines.map(bareLine);
  const end = lastIndex(bare, (line) => ERROR_ANNOTATION.test(line));
  if (end === -1) {
    return log;
  }
  const start = lastIndex(bare, (line) => STEP_START.test(line), end);
  return lines.slice(Math.max(start, 0), end + 1).join("\n");
};

/**
 * The last network error the step printed as an error. One it printed as a
 * warning, or said it would retry, is one it carried on past.
 */
const networkFailure = (step: string): string | null => {
  const failing = step.split("\n").flatMap((raw) => {
    const line = cleanLine(raw);
    const survived =
      WARNING_ANNOTATION.test(bareLine(raw)) || SURVIVED.test(line);
    return !survived && NETWORK_PATTERNS.some((pattern) => pattern.test(line))
      ? [line]
      : [];
  });
  return failing.at(-1) ?? null;
};

const firstMatch = (
  patterns: readonly RegExp[],
  lines: readonly string[]
): string | null => {
  for (const pattern of patterns) {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (line !== undefined) {
      return line;
    }
  }
  return null;
};

const clip = (line: string): string =>
  line.length > EVIDENCE_MAX ? `${line.slice(0, EVIDENCE_MAX - 1)}…` : line;

/** The line to show: the first strong error that is not the exit code, else the last error-looking one. */
export const evidenceLine = (log: string): string | null => {
  const lines = cleanLines(log).filter(
    (line) =>
      line !== "" && !EXIT_CODE_LINE.test(line) && !WRAPPER_LINE.test(line)
  );
  const strong = lines.find(isStrong);
  if (strong !== undefined) {
    return clip(strong);
  }
  let weak: string | null = null;
  for (const line of lines) {
    if (ERROR_LINE.test(line)) {
      weak = line;
    }
  }
  return weak === null ? null : clip(weak);
};

/** Paths named on lines that report an error, relative to the repository. */
export const failingFiles = (log: string): readonly string[] => {
  const found = new Set<string>();
  for (const line of cleanLines(log)) {
    if (!ERROR_LINE.test(line) && !STACK_FRAME.test(line)) {
      continue;
    }
    for (const match of line.matchAll(FILE_PATH)) {
      const path = (match[1] ?? "")
        .replace(RUNNER_WORKSPACE, "")
        .replace(/^\.\//u, "");
      if (path !== "" && !IGNORED_PATH.test(path)) {
        found.add(path);
      }
    }
  }
  return [...found];
};

/** `src/a.test.ts` is the test of `src/a.ts`: a change to either is a change to the module. */
const moduleOf = (path: string): string =>
  path.replace(/\.(?:test|spec)(?<extension>\.[a-z]+)$/u, "$<extension>");

/** A log path and a diff path name the same module when one is a suffix of the other. */
const sameFile = (failing: string, changed: string): boolean => {
  const [left, right] = [moduleOf(failing), moduleOf(changed)];
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
};

export interface ClassifyInput {
  /** The base branch's latest run of the same job; `unknown` when it was not read. */
  readonly base?: BaseVerdict;
  /** Paths the pull request changes. */
  readonly diffFiles: readonly string[];
  /** The tail of the failed job's log, or `null` when it could not be read. */
  readonly log: string | null;
}

const inDiff = (
  files: readonly string[],
  diffFiles: readonly string[]
): readonly string[] =>
  files.filter((file) => diffFiles.some((changed) => sameFile(file, changed)));

/** Applies the classification table to one failed job's log. */
export const classifyFailure = (input: ClassifyInput): Classification => {
  if (input.log === null || input.log.trim() === "") {
    return { files: [], kind: "unknown", line: null, reason: "no-log" };
  }
  const base = input.base ?? "unknown";
  const step = lastFailingStep(input.log);
  const lines = cleanLines(step);
  const infrastructure: readonly [FailureReason, readonly RegExp[]][] = [
    ["runner", RUNNER_PATTERNS],
    ["timeout", TIMEOUT_PATTERNS],
  ];
  for (const [reason, patterns] of infrastructure) {
    const line = firstMatch(patterns, lines);
    if (line !== null) {
      return { files: [], kind: "flake", line: clip(line), reason };
    }
  }
  const files = failingFiles(step);
  const changed = inDiff(files, input.diffFiles);
  const line = evidenceLine(step);
  const network = networkFailure(step);
  if (network !== null) {
    // The diff's own test can fail to connect because the diff broke what it connects to.
    return changed.length > 0 && base !== "red"
      ? { files: changed, kind: "own-code", line, reason: "in-diff" }
      : { files: [], kind: "flake", line: clip(network), reason: "network" };
  }
  if (files.length === 0) {
    return { files: [], kind: "unknown", line, reason: "no-file" };
  }
  if (changed.length > 0) {
    return { files: changed, kind: "own-code", line, reason: "in-diff" };
  }
  if (base === "red") {
    return { files, kind: "stale-base", line, reason: "outside-diff" };
  }
  return base === "green"
    ? { files, kind: "own-code", line, reason: "breaks-caller" }
    : { files, kind: "unknown", line, reason: "base-unread" };
};

/** An external check has no log; its own summary is the evidence. */
export const classifyExternal = (summary: string | null): Classification => ({
  files: [],
  kind: "external",
  line: summary === null ? null : clip(cleanLine(summary.split("\n")[0] ?? "")),
  reason: "external-check",
});
