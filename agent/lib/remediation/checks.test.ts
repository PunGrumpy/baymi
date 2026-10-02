import { describe, expect, it } from "vitest";

import {
  checkCommands,
  detectPackageManager,
  installCommand,
  parseNameStatus,
  readScripts,
  tail,
  verdict,
} from "#lib/remediation/checks";

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

describe(verdict, () => {
  const passed = { exitCode: 0, name: "test", output: "" };

  it("verifies only the change the passing checks ran on", () => {
    expect(
      verdict({
        currentDigest: "d1",
        ecosystem: "npm",
        record: { changeDigest: "d1", results: [passed] },
      })
    ).toStrictEqual({ reasons: [], verified: true });
  });

  it("collects every reason a change is unverified", () => {
    const result = verdict({
      currentDigest: "d2",
      ecosystem: "npm",
      record: {
        changeDigest: "d1",
        results: [passed, { exitCode: 1, name: "typecheck", output: "" }],
      },
    });
    expect(result.verified).toBeFalsy();
    expect(result.reasons).toStrictEqual([
      "The code changed after the checks last ran.",
      "typecheck exited with 1.",
    ]);
  });

  it("never verifies an ecosystem with no toolchain or no recorded run", () => {
    const result = verdict({
      currentDigest: "d1",
      ecosystem: "pip",
      record: null,
    });
    expect(result.reasons).toStrictEqual([
      "The sandbox has no toolchain for pip, so no check ran.",
      "The checks never ran.",
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
