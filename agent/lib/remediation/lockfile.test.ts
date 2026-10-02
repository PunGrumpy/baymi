import { describe, expect, it, vi } from "vitest";

import type { TextFetch } from "#lib/remediation/lockfile";
import {
  isExactVersion,
  versionsInBunLock,
  versionsInLockfiles,
  versionsInPackageLock,
} from "#lib/remediation/lockfile";

const BUN_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "dependencies": {
        "lodash": "^4.17.0",
      },
    },
  },
  "packages": {
    "@babel/core": ["@babel/core@7.24.0", "", {}, "sha512-a"],

    "lodash": ["lodash@4.17.10", "", {}, "sha512-b"],

    "old-dep/lodash": ["lodash@3.10.1", "", {}, "sha512-c"],

    "aliased": ["aliased@npm:lodash@4.17.21", "", {}, "sha512-d"],
  }
}`;

const PACKAGE_LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { lodash: "^4.17.0" } },
    "node_modules/lodash": { version: "4.17.10" },
    "node_modules/lodash-es": { version: "4.17.21" },
    "node_modules/old-dep/node_modules/lodash": { version: "3.10.1" },
  },
});

describe(isExactVersion, () => {
  it("accepts a release and refuses a range or a tag", () => {
    expect(isExactVersion("4.17.10")).toBeTruthy();
    expect(isExactVersion("2.0.0-rc.1")).toBeTruthy();
    expect(isExactVersion("^5.0.1")).toBeFalsy();
    expect(isExactVersion(">=1.0.0 <2.0.0")).toBeFalsy();
    expect(isExactVersion("latest")).toBeFalsy();
  });
});

describe(versionsInBunLock, () => {
  it("reads every installed version, nested ones included", () => {
    expect(versionsInBunLock(BUN_LOCK, "lodash")).toStrictEqual([
      "4.17.10",
      "3.10.1",
    ]);
    expect(versionsInBunLock(BUN_LOCK, "@babel/core")).toStrictEqual([
      "7.24.0",
    ]);
  });

  it("ignores the workspace ranges and an alias", () => {
    expect(versionsInBunLock(BUN_LOCK, "aliased")).toStrictEqual([]);
  });
});

describe(versionsInPackageLock, () => {
  it("reads node_modules entries and keeps similar names apart", () => {
    expect(versionsInPackageLock(PACKAGE_LOCK, "lodash")).toStrictEqual([
      "4.17.10",
      "3.10.1",
    ]);
  });

  it("answers nothing for a lockfile that is not JSON", () => {
    expect(versionsInPackageLock("{broken", "lodash")).toStrictEqual([]);
  });
});

describe(versionsInLockfiles, () => {
  it("reads bun.lock at the commit, and falls through to package-lock.json", async () => {
    const fetchImpl = vi.fn<TextFetch>((url) =>
      Promise.resolve(
        url.includes("/contents/bun.lock?")
          ? { ok: false, status: 404, text: () => Promise.resolve("") }
          : { ok: true, status: 200, text: () => Promise.resolve(PACKAGE_LOCK) }
      )
    );
    const result = await versionsInLockfiles({
      fetchImpl,
      packageName: "lodash",
      repository: "acme/widgets",
      sha: "abc1234",
      token: "tok",
    });
    expect(result).toStrictEqual({
      lockfile: "package-lock.json",
      versions: ["4.17.10", "3.10.1"],
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/acme/widgets/contents/bun.lock?ref=abc1234"
    );
    expect(fetchImpl.mock.calls[0]?.[1].headers.accept).toBe(
      "application/vnd.github.raw"
    );
  });

  it("answers null when no lockfile lists the package", async () => {
    const fetchImpl = vi.fn<TextFetch>(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve(""),
      })
    );
    const result = await versionsInLockfiles({
      fetchImpl,
      packageName: "lodash",
      repository: "acme/widgets",
      sha: "abc1234",
      token: "tok",
    });
    expect(result).toBeNull();
  });
});
