import { describe, expect, it } from "vitest";

import {
  classifyExternal,
  classifyFailure,
  evidenceLine,
  failingFiles,
  lastFailingStep,
} from "#lib/github/ci/classify";

const stamp = "2026-10-22T18:44:39.1234567Z";

/** An Actions log tail: timestamps, ANSI colour and the closing exit-code line. */
const log = (...lines: string[]): string =>
  [...lines, "##[error]Process completed with exit code 1."]
    .map((line) => `${stamp} ${line}`)
    .join("\n");

const DIFF = ["src/server.ts", "src/utils/format.ts", "README.md"];

describe("a flake or infrastructure failure", () => {
  it("is a network error in a step that touches no file the diff changed", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "##[group]Run bun install",
        "error: GET https://registry.npmjs.org/zod - ECONNRESET"
      ),
    });
    expect(result).toMatchObject({ kind: "flake", reason: "network" });
    expect(result.line).toBe(
      "error: GET https://registry.npmjs.org/zod - ECONNRESET"
    );
  });

  it("is a network error in the diff's own test when the base fails the same way", () => {
    const result = classifyFailure({
      base: "red",
      diffFiles: DIFF,
      log: log(
        "FAIL src/server.test.ts",
        "Error: connect ECONNRESET 140.82.112.3:443",
        "    at src/server.ts:42:9"
      ),
    });
    expect(result.kind).toBe("flake");
    expect(result.reason).toBe("network");
    expect(result.line).toBe("Error: connect ECONNRESET 140.82.112.3:443");
  });

  it("is a lost runner", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "##[error]The hosted runner lost communication with the server.",
        "src/server.ts"
      ),
    });
    expect(result).toMatchObject({ kind: "flake", reason: "runner" });
  });

  it("is a job that ran past its time limit", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "##[error]The job running on runner GitHub Actions 12 has exceeded the maximum execution time of 360 minutes."
      ),
    });
    expect(result).toMatchObject({ kind: "flake", reason: "timeout" });
  });

  it("is a registry or git transport error", () => {
    for (const text of [
      "npm ERR! network request to https://registry.npmjs.org/x failed",
      "error: RPC failed; curl 56 GnuTLS recv error",
      "getaddrinfo EAI_AGAIN registry.npmjs.org",
      "502 Bad Gateway",
      "429 Too Many Requests",
    ]) {
      expect(classifyFailure({ diffFiles: DIFF, log: log(text) }).kind).toBe(
        "flake"
      );
    }
  });
});

const BROKEN_PARSER =
  "src/legacy/parser.ts(18,7): error TS2322: Type 'string' is not assignable to type 'number'.";

describe("a stale base", () => {
  it("fails in a file the diff never touched, and fails the same way on the base", () => {
    const result = classifyFailure({
      base: "red",
      diffFiles: DIFF,
      log: log(BROKEN_PARSER),
    });
    expect(result).toMatchObject({
      files: ["src/legacy/parser.ts"],
      kind: "stale-base",
      reason: "outside-diff",
    });
    expect(result.line).toContain("error TS2322");
  });

  it("reads a runner's absolute path the way the diff names it", () => {
    const result = classifyFailure({
      base: "red",
      diffFiles: DIFF,
      log: log(
        "/home/runner/work/baymi/baymi/src/legacy/parser.ts:18:7 error: unexpected token"
      ),
    });
    expect(result.files).toStrictEqual(["src/legacy/parser.ts"]);
    expect(result.kind).toBe("stale-base");
  });

  it("is not guessed when the base's run could not be read", () => {
    expect(
      classifyFailure({ diffFiles: DIFF, log: log(BROKEN_PARSER) })
    ).toMatchObject({ kind: "unknown", reason: "base-unread" });
  });

  it("ignores a path inside node_modules", () => {
    expect(
      failingFiles(log("Error: boom at node_modules/zod/index.js:4:1"))
    ).toStrictEqual([]);
  });
});

describe("the diff's own code", () => {
  it("fails in a file the diff changed", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "FAIL src/utils/format.test.ts",
        "AssertionError: expected 'a' to equal 'b'",
        " ❯ src/utils/format.ts:12:3"
      ),
    });
    expect(result).toMatchObject({ kind: "own-code", reason: "in-diff" });
    expect(result.files).toStrictEqual([
      "src/utils/format.test.ts",
      "src/utils/format.ts",
    ]);
    expect(result.line).toBe("FAIL src/utils/format.test.ts");
  });

  it("reads a failing test as a failure in the module it tests", () => {
    const result = classifyFailure({
      diffFiles: ["src/utils/format.ts"],
      log: log("FAIL src/utils/format.test.ts"),
    });
    expect(result).toMatchObject({ kind: "own-code", reason: "in-diff" });
  });

  it("matches a bare file name against the diff's longer path", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log("error: format.ts:12:3 something broke"),
    });
    expect(result.kind).toBe("own-code");
  });

  it("is own code when one failing file is in the diff and another is not", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "src/legacy/parser.ts:1:1 error: broken",
        "src/server.ts:9:1 error: also broken"
      ),
    });
    expect(result.kind).toBe("own-code");
    expect(result.files).toStrictEqual(["src/server.ts"]);
  });
});

/** The cases the L5 verifier built against the first classifier, each of which it got wrong. */
describe("the cases the first classifier mislabeled", () => {
  it("is the diff's own code when an untouched caller breaks on what the diff changed and the base passes", () => {
    const result = classifyFailure({
      base: "green",
      diffFiles: ["src/api.ts"],
      log: log(
        "src/consumer.ts(3,10): error TS2305: Module '\"./api\"' has no exported member 'fetchUser'."
      ),
    });
    expect(result).toMatchObject({
      files: ["src/consumer.ts"],
      kind: "own-code",
      reason: "breaks-caller",
    });
  });

  it("is the diff's own code when a retried network warning in one step precedes a real type error in the next", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "##[group]Run bun install --frozen-lockfile",
        "bun install --frozen-lockfile",
        "##[endgroup]",
        "warn: ECONNRESET downloading zod, retrying (1/3)",
        "##[group]Run bun run typecheck",
        "bun run typecheck",
        "##[endgroup]",
        "src/server.ts(3,1): error TS2322: Type 'number' is not assignable to type 'string'."
      ),
    });
    expect(result).toMatchObject({ kind: "own-code", reason: "in-diff" });
    expect(result.line).toContain("error TS2322");
  });

  it("is the diff's own code when the retry and the type error are in one step", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log(
        "npm WARN network ECONNRESET fetching zod, will retry",
        "##[warning]getaddrinfo EAI_AGAIN registry.npmjs.org",
        "src/server.ts(3,1): error TS2322: Type 'number' is not assignable to type 'string'."
      ),
    });
    expect(result).toMatchObject({ kind: "own-code", reason: "in-diff" });
  });

  it("is the diff's own code when the diff's own test fails on ECONNREFUSED and the base passes", () => {
    const failure = log(
      "FAIL src/db.test.ts > connects to the database",
      "Error: connect ECONNREFUSED 127.0.0.1:5432",
      " ❯ src/db.ts:10:5",
      "Test Files  1 failed (1)"
    );
    expect(
      classifyFailure({ base: "green", diffFiles: ["src/db.ts"], log: failure })
    ).toMatchObject({
      files: ["src/db.test.ts", "src/db.ts"],
      kind: "own-code",
    });
    expect(
      classifyFailure({ diffFiles: ["src/db.ts"], log: failure }).kind
    ).toBe("own-code");
    expect(
      classifyFailure({ base: "red", diffFiles: ["src/db.ts"], log: failure })
    ).toMatchObject({ kind: "flake", reason: "network" });
  });
});

describe(lastFailingStep, () => {
  it("keeps the step that failed and drops the steps before it and the cleanup after it", () => {
    const step = lastFailingStep(
      `${log(
        "##[group]Run bun install",
        "Error: connect ECONNRESET 1.2.3.4:443 (retried, then fine)",
        "##[group]Run bun test",
        "FAIL src/server.test.ts"
      )}\n2026-10-22T18:44:40Z ##[group]Run actions/cache/save\n2026-10-22T18:44:40Z Post job cleanup.`
    );
    expect(step).toContain("FAIL src/server.test.ts");
    expect(step).not.toContain("ECONNRESET");
    expect(step).not.toContain("Post job cleanup");
  });

  it("is the whole log when it has no error annotation", () => {
    expect(lastFailingStep("a\nb")).toBe("a\nb");
  });
});

describe("a failure it cannot place", () => {
  it("is unknown without a log", () => {
    expect(classifyFailure({ diffFiles: DIFF, log: null })).toStrictEqual({
      files: [],
      kind: "unknown",
      line: null,
      reason: "no-log",
    });
    expect(classifyFailure({ diffFiles: DIFF, log: "  \n" }).reason).toBe(
      "no-log"
    );
  });

  it("is unknown when the log names no file", () => {
    const result = classifyFailure({
      diffFiles: DIFF,
      log: log("Error: something failed with no location"),
    });
    expect(result).toMatchObject({ kind: "unknown", reason: "no-file" });
    expect(result.line).toBe("Error: something failed with no location");
  });
});

/**
 * The tail of a real failed job, logixlysia run 39357357013 (2026-10-20): an
 * action's `fail-on-cache-miss: false` input far up, a compiler error under
 * its `.mdx` file, and four lines that only say a command exited.
 */
const REAL_TYPECHECK_LOG = [
  "2026-10-20T02:09:29.8185271Z   fail-on-cache-miss: false",
  "2026-10-20T02:09:49.9443291Z $ tsc --noEmit && bun scripts/typecheck-snippets.ts",
  "2026-10-20T02:09:49.9512277Z configuration.mdx#21 (line 297): TS2304 Cannot find name 'token'. (+2 more)",
  "2026-10-20T02:09:49.9513422Z features/request-id.mdx#4 (line 74): TS2304 Cannot find name 'getTraceId'.",
  "2026-10-20T02:09:49.9523526Z checked 215 blocks, skipped 26, expected-errors 1, 4 unexpected errors",
  '2026-10-20T02:09:49.9524367Z error: script "typecheck" exited with code 1',
  "2026-10-20T02:09:50.1114088Z ##[error]command (/home/runner/work/logixlysia/logixlysia/apps/docs) /home/runner/.bun/bin/bun run typecheck exited (1)",
  "2026-10-20T02:09:50.1127983Z docs#typecheck:  ERROR  command (/home/runner/work/logixlysia/logixlysia/apps/docs) /home/runner/.bun/bin/bun run typecheck exited (1)",
  "2026-10-20T02:09:50.1130924Z Failed:    docs#typecheck",
  "2026-10-20T02:09:50.1215099Z ##[error]Process completed with exit code 1.",
].join("\n");

describe("a real typecheck log", () => {
  it("shows the compiler error, not the action input or the wrapper lines", () => {
    expect(evidenceLine(REAL_TYPECHECK_LOG)).toBe(
      "configuration.mdx#21 (line 297): TS2304 Cannot find name 'token'. (+2 more)"
    );
  });

  it("reads .mdx as .mdx, not as .md followed by an x", () => {
    expect(failingFiles(REAL_TYPECHECK_LOG)).toStrictEqual([
      "configuration.mdx",
      "features/request-id.mdx",
    ]);
  });

  it("is a stale base for a pull request that touches other files, when the base fails it too", () => {
    expect(
      classifyFailure({
        base: "red",
        diffFiles: ["apps/docs/content/index.mdx"],
        log: REAL_TYPECHECK_LOG,
      }).kind
    ).toBe("stale-base");
  });

  it("is the diff's own code for a pull request that touches other files, when the base passes", () => {
    expect(
      classifyFailure({
        base: "green",
        diffFiles: ["apps/docs/content/index.mdx"],
        log: REAL_TYPECHECK_LOG,
      })
    ).toMatchObject({ kind: "own-code", reason: "breaks-caller" });
  });

  it("is the diff's own code for a pull request that edits the page", () => {
    const result = classifyFailure({
      diffFiles: ["apps/docs/content/docs/configuration.mdx"],
      log: REAL_TYPECHECK_LOG,
    });
    expect(result.kind).toBe("own-code");
    expect(result.files).toStrictEqual(["configuration.mdx"]);
  });
});

describe(evidenceLine, () => {
  it("strips the timestamp, the colour and the annotation prefix, and skips the exit code", () => {
    expect(
      evidenceLine(
        `${stamp} \u001B[31m##[error]error TS2345: bad argument\u001B[0m\n${stamp} ##[error]Process completed with exit code 2.`
      )
    ).toBe("error TS2345: bad argument");
  });

  it("cuts a long line", () => {
    const line = evidenceLine(`error: ${"x".repeat(400)}`);
    expect(line?.length).toBe(160);
    expect(line?.endsWith("…")).toBeTruthy();
  });

  it("is null when nothing looks like an error", () => {
    expect(evidenceLine("all quiet\nnothing here")).toBeNull();
  });
});

describe(classifyExternal, () => {
  it("keeps the check's own first line as the evidence", () => {
    expect(classifyExternal("1 secret incident found\nmore")).toStrictEqual({
      files: [],
      kind: "external",
      line: "1 secret incident found",
      reason: "external-check",
    });
  });

  it("has no evidence when the check gave no summary", () => {
    expect(classifyExternal(null).line).toBeNull();
  });
});
