import { describe, expect, it } from "vitest";

import {
  checkCommands,
  commandTimeout,
  detectPackageManager,
  fixVerdict,
  installCommand,
  parseNameStatus,
  readScripts,
  reproduced,
  rewriteReason,
  rewrote,
  tail,
} from "#lib/chase/checks";

describe(detectPackageManager, () => {
  it("names the manager whose lockfile is at the root", () => {
    expect(detectPackageManager(["package.json", "bun.lock"])).toBe("bun");
    expect(detectPackageManager(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(detectPackageManager(["yarn.lock"])).toBe("yarn");
    expect(detectPackageManager(["package-lock.json"])).toBe("npm");
    expect(detectPackageManager(["go.mod"])).toBeNull();
  });
});

describe(installCommand, () => {
  it("keeps lifecycle scripts off and the lockfile frozen for every manager", () => {
    expect(installCommand("bun")).toContain(
      "bun install --frozen-lockfile --ignore-scripts"
    );
    expect(installCommand("pnpm")).toContain(
      "pnpm install --frozen-lockfile --ignore-scripts"
    );
    expect(installCommand("npm")).toContain("npm ci --ignore-scripts");
    expect(installCommand("yarn")).toContain(
      "yarn install --immutable --mode=skip-build"
    );
  });
});

describe(checkCommands, () => {
  it("runs the defined scripts in order, bounded and outside watch mode", () => {
    const commands = checkCommands("bun", {
      build: "tsc",
      test: "vitest",
      typecheck: "tsc --noEmit",
    });
    expect(commands.map((command) => command.name)).toStrictEqual([
      "typecheck",
      "test",
    ]);
    expect(commands[1]?.command).toBe("CI=true timeout 600 bun run test");
  });
});

describe(readScripts, () => {
  it("reads the scripts, and none from a missing or broken manifest", () => {
    expect(readScripts('{"scripts":{"test":"vitest"}}')).toStrictEqual({
      test: "vitest",
    });
    expect(readScripts(null)).toStrictEqual({});
    expect(readScripts("{not json")).toStrictEqual({});
  });
});

describe(tail, () => {
  it("keeps the end of a long output", () => {
    expect(tail("abcdef", 4)).toBe("…def");
    expect(tail("abc", 4)).toBe("abc");
  });
});

describe(commandTimeout, () => {
  it("caps a command at ten minutes and at what is left of the budget", () => {
    expect(commandTimeout(5000)).toBe(600);
    expect(commandTimeout(90.7)).toBe(90);
    expect(commandTimeout(0)).toBe(1);
  });

  it("bounds the install and every check by the same limit", () => {
    expect(installCommand("npm", 90)).toBe(
      "timeout 90 npm ci --ignore-scripts"
    );
    expect(checkCommands("npm", { test: "jest" }, 90)[0]?.command).toBe(
      "CI=true timeout 90 npm run test"
    );
  });
});

const CLEAN = "c".repeat(40);
const EDITED = "e".repeat(40);

describe(fixVerdict, () => {
  const passed = { exitCode: 0, name: "test", output: "" };
  const failed = { exitCode: 1, name: "test", output: "1 failed" };
  // Run 1 reproduces on the clean checkout (B = A); run 2 passes on the edit (B = C).
  const baseline = {
    changeDigest: CLEAN,
    results: [passed, failed],
    treeBefore: CLEAN,
  };
  const latest = {
    changeDigest: EDITED,
    results: [passed],
    treeBefore: EDITED,
  };
  const verified = {
    baseline,
    cleanTree: CLEAN,
    currentDigest: EDITED,
    headTree: CLEAN,
    latest,
  };

  it("verifies a change the checks passed on after they reproduced the failure", () => {
    expect(reproduced(baseline)).toBeTruthy();
    expect(fixVerdict(verified)).toStrictEqual({ reasons: [], verified: true });
  });

  it("collects every reason a change is unverified", () => {
    const result = fixVerdict({
      ...verified,
      currentDigest: "f".repeat(40),
      latest: {
        ...latest,
        results: [passed, { exitCode: 2, name: "typecheck", output: "" }],
      },
    });
    expect(result.verified).toBeFalsy();
    expect(result.reasons).toStrictEqual([
      "The code changed after the checks last ran.",
      "typecheck exited with 2.",
    ]);
  });

  it("never verifies a fix for a failure the checks did not reproduce", () => {
    const green = { ...baseline, results: [passed] };
    expect(reproduced(green)).toBeFalsy();
    expect(fixVerdict({ ...verified, baseline: green }).reasons).toStrictEqual([
      "The failure did not reproduce: every check passed on the head as it was.",
    ]);
  });

  it("never verifies a change the sandbox could not measure", () => {
    expect(
      fixVerdict({
        ...verified,
        currentDigest: "",
        latest: { ...latest, changeDigest: "" },
      }).reasons
    ).toStrictEqual(["The change could not be measured in the sandbox."]);
    expect(
      fixVerdict({ ...verified, cleanTree: "", headTree: CLEAN }).reasons
    ).toContain("The change could not be measured in the sandbox.");
  });

  it("never verifies without a run before and after the change", () => {
    expect(
      fixVerdict({
        baseline: null,
        cleanTree: CLEAN,
        currentDigest: EDITED,
        headTree: CLEAN,
        latest: null,
      }).reasons
    ).toStrictEqual([
      "The failure was never reproduced: the checks never ran.",
      "The checks did not run after the change.",
    ]);
  });

  it("never verifies a tree the install or the checks rewrote", () => {
    const rewritten = { ...latest, changeDigest: "f".repeat(40) };
    expect(
      fixVerdict({
        ...verified,
        currentDigest: rewritten.changeDigest,
        latest: rewritten,
      }).reasons
    ).toStrictEqual(["The install or the checks rewrote files."]);
  });

  it("never verifies a reproduction that ran on an already edited tree", () => {
    expect(
      fixVerdict({
        ...verified,
        baseline: { ...baseline, changeDigest: EDITED, treeBefore: EDITED },
      }).reasons
    ).toStrictEqual([
      "The failure was reproduced on a tree that was already edited, not on the head as it was.",
    ]);
  });

  it("never verifies once the checkout's baseline commit moved", () => {
    expect(fixVerdict({ ...verified, headTree: EDITED }).reasons).toStrictEqual(
      ["The checkout's baseline commit moved."]
    );
    expect(fixVerdict({ ...verified, headTree: "" }).reasons).toStrictEqual([
      "The checkout's baseline could not be measured in the sandbox.",
    ]);
  });
});

const run = (before: string, after: string) => ({
  changeDigest: after,
  results: [],
  treeBefore: before,
});

describe(rewrote, () => {
  it("is a tree that differs from the one the run started with", () => {
    expect(rewrote(run(CLEAN, EDITED))).toBeTruthy();
    expect(rewrote(run(CLEAN, CLEAN))).toBeFalsy();
  });

  it("does not call an unmeasured run a rewrite, and never a missing one", () => {
    expect(rewrote(run("", EDITED))).toBeFalsy();
    expect(rewrote(run(CLEAN, ""))).toBeFalsy();
    expect(rewrote(null)).toBeFalsy();
  });
});

describe(rewriteReason, () => {
  it("names the paths the checks rewrote", () => {
    expect(rewriteReason(["bun.lock", "src/format.ts"])).toBe(
      "The project's own install or checks rewrote 2 files (bun.lock, src/format.ts), so what they passed on is not the change the chase made, and nothing was pushed."
    );
  });

  it("names one, many, and none it could list", () => {
    expect(rewriteReason(["a"])).toContain("1 file (a)");
    const many = Array.from({ length: 12 }, (_, index) => `f${index}`);
    expect(rewriteReason(many)).toContain("12 files (f0, f1");
    expect(rewriteReason(many)).toContain("and 2 more)");
    expect(rewriteReason([])).toContain("files the sandbox could not list");
  });
});

describe(parseNameStatus, () => {
  it("reads NUL-separated status and path pairs", () => {
    expect(
      parseNameStatus("M\0package.json\0D\0old file.ts\0A\0src/new.ts\0")
    ).toStrictEqual([
      { deleted: false, path: "package.json" },
      { deleted: true, path: "old file.ts" },
      { deleted: false, path: "src/new.ts" },
    ]);
  });
});
