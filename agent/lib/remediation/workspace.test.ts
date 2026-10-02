import { describe, expect, it } from "vitest";

import {
  BASELINE_COMMAND,
  CHANGES_COMMAND,
  isPushablePath,
  parseModes,
} from "#lib/remediation/workspace";

describe(parseModes, () => {
  it("keeps the executable bit and treats every other mode as a regular file", () => {
    const modes = parseModes(
      [
        "100755 aaa 0\tscripts/run.sh",
        "100644 bbb 0\tpackage.json",
        "120000 ccc 0\tlink",
      ].join("\u0000")
    );
    expect(modes.get("scripts/run.sh")).toBe("100755");
    expect(modes.get("package.json")).toBe("100644");
    expect(modes.get("link")).toBe("100644");
  });
});

describe(isPushablePath, () => {
  it.each(["package.json", "packages/a/bun.lock", "src/index.ts"])(
    "pushes %s",
    (path) => {
      expect(isPushablePath(path)).toBeTruthy();
    }
  );

  it.each([
    "",
    "/etc/passwd",
    "../outside",
    "node_modules/x/index.js",
    "a/node_modules/b",
  ])("refuses %s", (path) => {
    expect(isPushablePath(path)).toBeFalsy();
  });
});

describe("the workspace commands", () => {
  it("leave installed dependencies out of the baseline and the change", () => {
    expect(BASELINE_COMMAND).toContain("':(exclude)node_modules'");
    expect(CHANGES_COMMAND).toContain("':(exclude)**/node_modules'");
    expect(CHANGES_COMMAND).toContain("--no-renames");
  });
});
