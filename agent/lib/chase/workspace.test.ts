import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { parseNameStatus } from "#lib/chase/checks";
import {
  BASELINE_COMMAND,
  CHANGES_COMMAND,
  decodeListing,
  MODES_COMMAND,
  isPushablePath,
  parseModes,
} from "#lib/chase/workspace";

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
  it("leave installed dependencies out of the baseline and the change, without a pathspec git refuses", () => {
    expect(BASELINE_COMMAND).toContain(
      "printf '%s\\n' node_modules/ >> .git/info/exclude"
    );
    expect(CHANGES_COMMAND).not.toContain(":(exclude)");
    expect(CHANGES_COMMAND).toContain("--no-renames");
  });
});

describe(decodeListing, () => {
  it("gives back the NUL-separated listing the sandbox printed as base64", () => {
    const listing = "M\0agent/lib/sum.ts\0D\0old file.ts\0";
    const printed = `${Buffer.from(listing).toString("base64")}\n`;
    expect(parseNameStatus(decodeListing(printed))).toStrictEqual([
      { deleted: false, path: "agent/lib/sum.ts" },
      { deleted: true, path: "old file.ts" },
    ]);
    expect(CHANGES_COMMAND).toContain("| base64 | tr -d");
    expect(MODES_COMMAND).toContain("git ls-files -s -z | base64");
  });
});
