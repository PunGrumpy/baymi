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
  it("keeps lifecycle scripts off for every manager", () => {
    expect(installCommand("bun")).toContain("bun install --ignore-scripts");
    expect(installCommand("npm")).toContain("npm install --ignore-scripts");
    expect(installCommand("yarn")).toContain("yarn install --mode=skip-build");
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
      "timeout 90 npm install --ignore-scripts"
    );
    expect(checkCommands("npm", { test: "jest" }, 90)[0]?.command).toBe(
      "CI=true timeout 90 npm run test"
    );
  });
});

describe(fixVerdict, () => {
  const passed = { exitCode: 0, name: "test", output: "" };
  const failed = { exitCode: 1, name: "test", output: "1 failed" };
  const baseline = { changeDigest: "d0", results: [passed, failed] };

  it("verifies a change the checks passed on after they reproduced the failure", () => {
    expect(reproduced(baseline)).toBeTruthy();
    expect(
      fixVerdict({
        baseline,
        currentDigest: "d1",
        latest: { changeDigest: "d1", results: [passed] },
      })
    ).toStrictEqual({ reasons: [], verified: true });
  });

  it("collects every reason a change is unverified", () => {
    const result = fixVerdict({
      baseline,
      currentDigest: "d2",
      latest: {
        changeDigest: "d1",
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
    const green = { changeDigest: "d0", results: [passed] };
    expect(reproduced(green)).toBeFalsy();
    expect(
      fixVerdict({
        baseline: green,
        currentDigest: "d1",
        latest: { changeDigest: "d1", results: [passed] },
      }).reasons
    ).toStrictEqual([
      "The failure did not reproduce: every check passed on the head as it was.",
    ]);
  });

  it("never verifies without a run before and after the change", () => {
    expect(
      fixVerdict({ baseline: null, currentDigest: "d1", latest: null }).reasons
    ).toStrictEqual([
      "The failure was never reproduced: the checks never ran.",
      "The checks did not run after the change.",
    ]);
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
