import { describe, expect, it, vi } from "vitest";

import {
  lockfileChanges,
  readDependencyChanges,
  REPOSITORY_PATTERN,
  summarizeDependencyChanges,
  unavailableReason,
} from "#lib/github/dependencies";
import type { FetchLike } from "#lib/github/installation";
import type { TextFetch } from "#lib/remediation/lockfile";

const advisory = {
  advisory_ghsa_id: "GHSA-xxxx-yyyy-zzzz",
  advisory_summary: "Prototype pollution in merge",
  advisory_url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
  severity: "high",
};

const change = (
  changeType: "added" | "removed",
  name: string,
  version: string,
  vulnerabilities: readonly (typeof advisory)[] = []
) => ({
  change_type: changeType,
  ecosystem: "npm",
  manifest: "package-lock.json",
  name,
  scope: "runtime",
  version,
  vulnerabilities: [...vulnerabilities],
});

/** A GitHub response body: an object, or the compare endpoint's array. */
type ResponseBody =
  | typeof pullRequest
  | readonly ReturnType<typeof change>[]
  | { readonly message: string };

const answer = (body: ResponseBody, status = 200) => ({
  json: () => Promise.resolve(body),
  ok: status >= 200 && status < 300,
  status,
});

const pullRequest = { base: { sha: "base1" }, head: { sha: "head2" } };

/** No root lockfile at either commit, so GitHub's comparison answers. */
const noLockfile: TextFetch = () =>
  Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });

const bunLock = (...entries: readonly string[]) =>
  `  "packages": {\n${entries
    .map((entry) => {
      const name = entry.slice(0, entry.lastIndexOf("@"));
      return `    "${name}": ["${entry}", "", {}, "sha512-x"],`;
    })
    .join("\n")}\n  }`;

/** A bun.lock at each commit: the base's and the head's. */
const lockfiles =
  (base: string | null, head: string): TextFetch =>
  (url) => {
    let text: string | null = null;
    if (url.includes("/contents/bun.lock?ref=head2")) {
      text = head;
    } else if (url.includes("/contents/bun.lock?ref=base1")) {
      text = base;
    }
    return Promise.resolve(
      text === null
        ? { ok: false, status: 404, text: () => Promise.resolve("") }
        : { ok: true, status: 200, text: () => Promise.resolve(text ?? "") }
    );
  };

describe(summarizeDependencyChanges, () => {
  it("keeps the advisories on an added version and drops removals", () => {
    const summary = summarizeDependencyChanges([
      change("removed", "lodash", "4.17.20"),
      change("added", "lodash", "4.17.10", [advisory]),
      change("added", "zod", "4.1.0"),
    ]);
    expect(summary).toStrictEqual({
      added: 2,
      addedClean: ["zod@4.1.0"],
      available: true,
      removed: 1,
      vulnerable: [
        {
          advisories: [
            {
              ghsa: "GHSA-xxxx-yyyy-zzzz",
              severity: "high",
              summary: "Prototype pollution in merge",
              url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
            },
          ],
          ecosystem: "npm",
          manifest: "package-lock.json",
          name: "lodash",
          scope: "runtime",
          version: "4.17.10",
        },
      ],
    });
  });

  it("caps the clean names a lockfile churn produces", () => {
    const changes = Array.from({ length: 80 }, (_, index) =>
      change("added", `pkg-${index}`, "1.0.0")
    );
    const summary = summarizeDependencyChanges(changes);
    expect(summary.added).toBe(80);
    expect(summary.addedClean).toHaveLength(50);
  });
});

describe(readDependencyChanges, () => {
  it("compares the pull request's base and head commits", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(answer(pullRequest))
      .mockResolvedValueOnce(
        answer([change("added", "lodash", "4.17.10", [advisory])])
      );
    const result = await readDependencyChanges({
      fetchImpl,
      pullRequestNumber: 7,
      repository: "acme/widgets",
      textFetchImpl: noLockfile,
      token: "tok",
    });
    expect(result.available).toBeTruthy();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/acme/widgets/pulls/7"
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/acme/widgets/dependency-graph/compare/base1...head2"
    );
    expect(fetchImpl.mock.calls[1]?.[1].headers.authorization).toBe(
      "Bearer tok"
    );
  });

  it("answers unavailable when the repository has dependency review off", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(answer(pullRequest))
      .mockResolvedValueOnce(answer({ message: "Forbidden" }, 403));
    const result = await readDependencyChanges({
      fetchImpl,
      pullRequestNumber: 7,
      repository: "acme/widgets",
      textFetchImpl: noLockfile,
      token: "tok",
    });
    expect(result).toStrictEqual({
      available: false,
      reason: unavailableReason(403),
    });
  });

  it("answers unavailable when the pull request cannot be read", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(answer({ message: "Not Found" }, 404));
    const result = await readDependencyChanges({
      fetchImpl,
      pullRequestNumber: 7,
      repository: "acme/widgets",
      textFetchImpl: noLockfile,
      token: "tok",
    });
    expect(result.available).toBeFalsy();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("the repository pattern", () => {
  it.each(["acme/widgets", "acme/widgets.js", "my-org/my_repo"])(
    "takes %s",
    (repository) => {
      expect(REPOSITORY_PATTERN.test(repository)).toBeTruthy();
    }
  );

  it.each([
    "acme/../secrets",
    "../..",
    "acme/..",
    "acme/widgets/pulls",
    "acme",
  ])("refuses %s, which a path could be built from", (repository) => {
    expect(REPOSITORY_PATTERN.test(repository)).toBeFalsy();
  });
});

describe(lockfileChanges, () => {
  const undiciAdvisory = {
    cve_id: null,
    ghsa_id: "GHSA-pmjh-fq2x-6v4x",
    html_url: "https://github.com/advisories/GHSA-pmjh-fq2x-6v4x",
    severity: "medium",
    summary: "undici issue",
    vulnerabilities: [
      {
        first_patched_version: "8.10.2",
        package: { ecosystem: "npm", name: "undici" },
        vulnerable_version_range: ">= 8.0.0, < 8.10.2",
      },
    ],
  };

  it("diffs bun.lock between the commits and checks only what was added", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      json: () => Promise.resolve([undiciAdvisory]),
      ok: true,
      status: 200,
    });
    const result = await lockfileChanges({
      baseSha: "base1",
      fetchImpl,
      headSha: "head2",
      repository: "acme/widgets",
      textFetchImpl: lockfiles(
        bunLock("undici@8.10.2", "zod@4.6.2"),
        bunLock("undici@8.9.0", "zod@4.6.2", "hono@4.9.0")
      ),
      token: "tok",
    });
    expect(result).toMatchObject({
      added: 2,
      addedClean: ["hono@4.9.0"],
      available: true,
      removed: 1,
      vulnerable: [
        {
          advisories: [{ ghsa: "GHSA-pmjh-fq2x-6v4x" }],
          manifest: "bun.lock",
          name: "undici",
          version: "8.9.0",
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("answers null when the head has no npm or Bun lockfile", async () => {
    const result = await lockfileChanges({
      baseSha: "base1",
      fetchImpl: vi.fn<FetchLike>(),
      headSha: "head2",
      repository: "acme/widgets",
      textFetchImpl: noLockfile,
      token: "tok",
    });
    expect(result).toBeNull();
  });

  it("reports a lookup that dies mid-call as unavailable", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(answer(pullRequest));
    const result = await readDependencyChanges({
      fetchImpl,
      pullRequestNumber: 7,
      repository: "acme/widgets",
      textFetchImpl: () => Promise.reject(new Error("ECONNRESET")),
      token: "tok",
    });
    expect(result).toStrictEqual({
      available: false,
      reason: "Reading the lockfile changes failed: Error: ECONNRESET",
    });
  });
});
