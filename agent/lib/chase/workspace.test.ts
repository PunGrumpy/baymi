import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { parseNameStatus } from "#lib/chase/checks";
import {
  BASELINE_COMMAND,
  CHANGES_COMMAND,
  decodeListing,
  commitMode,
  isPushablePath,
  MODES_COMMAND,
  modeProblems,
  parseModes,
  pathProblem,
} from "#lib/chase/workspace";

describe(parseModes, () => {
  it("keeps each staged entry's mode as git prints it", () => {
    const modes = parseModes(
      [
        "100755 aaa 0\tscripts/run.sh",
        "100644 bbb 0\tpackage.json",
        "120000 ccc 0\tlink",
        "160000 ddd 0\tvendor/sub",
      ].join("\u0000")
    );
    expect(Object.fromEntries(modes)).toStrictEqual({
      link: "120000",
      "package.json": "100644",
      "scripts/run.sh": "100755",
      "vendor/sub": "160000",
    });
  });
});

describe(modeProblems, () => {
  const modes = parseModes(
    [
      "100644 a 0\tsrc/math.ts",
      "100755 b 0\tscripts/run.sh",
      "120000 c 0\tleak-file",
      "160000 d 0\tvendor/sub",
    ].join("\u0000")
  );

  it("accepts regular and executable files", () => {
    expect(
      modeProblems(
        [
          { deleted: false, path: "src/math.ts" },
          { deleted: false, path: "scripts/run.sh" },
        ],
        modes
      )
    ).toStrictEqual([]);
  });

  it("refuses a symlink in the change set, which would be pushed as the target's bytes", () => {
    expect(
      modeProblems([{ deleted: false, path: "leak-file" }], modes)
    ).toStrictEqual([
      "leak-file is a symlink (mode 120000); a chase pushes regular files only.",
    ]);
  });

  it("refuses a submodule and a path with no index entry, and lets a deletion through", () => {
    expect(
      modeProblems(
        [
          { deleted: false, path: "vendor/sub" },
          { deleted: false, path: "ghost" },
          { deleted: true, path: "leak-file" },
        ],
        modes
      )
    ).toStrictEqual([
      "vendor/sub is a submodule (mode 160000); a chase pushes regular files only.",
      "ghost has no entry in the index, so its mode is unknown.",
    ]);
  });
});

describe(commitMode, () => {
  it("commits an executable as such and everything else as a regular file", () => {
    const modes = parseModes(
      ["100755 a 0\trun.sh", "100644 b 0\tindex.ts"].join("\u0000")
    );
    expect(commitMode(modes, "run.sh")).toBe("100755");
    expect(commitMode(modes, "index.ts")).toBe("100644");
  });
});

describe(pathProblem, () => {
  it.each([
    ".github/workflows/ci.yml",
    ".github/workflows/nested/deploy.yaml",
    ".GitHub/Workflows/CI.yml",
    ".github/workflows",
  ])("says %s is a workflow a chase never changes", (path) => {
    expect(pathProblem(path)).toBe(
      `${path} is under .github/workflows, which a chase never changes.`
    );
  });

  it.each([
    ".github/dependabot.yml",
    ".github/workflows-notes.md",
    "docs/.github/x",
  ])("has no objection to %s", (path) => {
    expect(pathProblem(path)).toBeNull();
  });

  it("refuses a path inside .git", () => {
    expect(pathProblem("sub/.git/config")).toBe(
      "sub/.git/config may not be pushed."
    );
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
    ".github/workflows/ci.yml",
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
