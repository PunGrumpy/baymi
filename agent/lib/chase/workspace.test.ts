import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseNameStatus } from "#lib/chase/checks";
import {
  BASELINE_COMMAND,
  BASELINE_TREE_COMMAND,
  CHANGES_COMMAND,
  decodeListing,
  commitMode,
  isPushablePath,
  MODES_COMMAND,
  modeProblems,
  parseModes,
  pathProblem,
  REPO_DIR,
  TREE_COMMAND,
  treeDiffCommand,
  treeId,
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

/**
 * The real commands, run with real git in a temporary directory standing in
 * for the sandbox's checkout. Only the path differs.
 */
describe("the tree commands against a real checkout", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  const checkout = () => {
    const root = mkdtempSync(nodePath.join(tmpdir(), "chase-workspace-"));
    roots.push(root);
    mkdirSync(nodePath.join(root, "src"));
    writeFileSync(
      nodePath.join(root, "src", "math.ts"),
      "export const sum = 0;\n"
    );
    writeFileSync(nodePath.join(root, "bun.lock"), "lock v1\n");
    writeFileSync(nodePath.join(root, ".gitignore"), "dist/\n");
    const run = (command: string) => {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      };
      try {
        return {
          exitCode: 0,
          stdout: execFileSync(
            "sh",
            ["-c", command.replaceAll(REPO_DIR, root)],
            {
              encoding: "utf-8",
              env,
              stdio: ["ignore", "pipe", "pipe"],
            }
          ),
        };
      } catch {
        return { exitCode: 1, stdout: "" };
      }
    };
    expect(run(BASELINE_COMMAND.replaceAll(REPO_DIR, root)).exitCode).toBe(0);
    return { root, run };
  };

  it("measures A, B and C, and names a file a check rewrote", () => {
    const { root, run } = checkout();
    const clean = treeId(run(BASELINE_TREE_COMMAND));
    // Nothing edited: B is A.
    const untouched = treeId(run(TREE_COMMAND));
    expect(untouched).toBe(clean);
    // The model's edit moves B off A.
    writeFileSync(
      nodePath.join(root, "src", "math.ts"),
      "export const sum = 5;\n"
    );
    const before = treeId(run(TREE_COMMAND));
    expect(before).not.toBe(clean);
    // A check that is a formatter in disguise rewrites a tracked file and
    // another that the model never touched; an ignored build output is no change.
    writeFileSync(nodePath.join(root, "bun.lock"), "lock v2\n");
    writeFileSync(nodePath.join(root, "src", "format.ts"), "formatted\n");
    mkdirSync(nodePath.join(root, "dist"));
    writeFileSync(nodePath.join(root, "dist", "out.js"), "built\n");
    mkdirSync(nodePath.join(root, "node_modules"));
    writeFileSync(nodePath.join(root, "node_modules", "x.js"), "installed\n");
    const after = treeId(run(TREE_COMMAND));
    expect(after).not.toBe(before);
    const diff = treeDiffCommand(before, after);
    expect(diff).not.toBeNull();
    const listed = run(diff ?? "");
    expect(
      parseNameStatus(decodeListing(listed.stdout)).map((change) => change.path)
    ).toStrictEqual(["bun.lock", "src/format.ts"]);
  });

  it("leaves the tree alone when only ignored files change", () => {
    const { root, run } = checkout();
    const before = treeId(run(TREE_COMMAND));
    mkdirSync(nodePath.join(root, "dist"));
    writeFileSync(nodePath.join(root, "dist", "out.js"), "built\n");
    mkdirSync(nodePath.join(root, "node_modules"));
    writeFileSync(nodePath.join(root, "node_modules", "x.js"), "installed\n");
    expect(treeId(run(TREE_COMMAND))).toBe(before);
  });

  it("lists a symlink with mode 120000, which push_fix then refuses", () => {
    const { root, run } = checkout();
    symlinkSync("/etc/hostname", nodePath.join(root, "leak-file"));
    const modes = parseModes(decodeListing(run(MODES_COMMAND).stdout));
    expect(modes.get("leak-file")).toBe("120000");
    expect(
      modeProblems([{ deleted: false, path: "leak-file" }], modes)
    ).toStrictEqual([
      "leak-file is a symlink (mode 120000); a chase pushes regular files only.",
    ]);
  });

  it("refuses a tree id the sandbox could have forged before it reaches a shell", () => {
    expect(treeDiffCommand("a".repeat(40), "b".repeat(40))).not.toBeNull();
    expect(treeDiffCommand("a".repeat(40), "$(touch pwned)")).toBeNull();
    expect(treeId({ exitCode: 0, stdout: "not a tree\n" })).toBe("");
    expect(treeId({ exitCode: 1, stdout: "a".repeat(40) })).toBe("");
  });
});
