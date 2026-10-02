import { describe, expect, it, vi } from "vitest";

import {
  readDependencyChanges,
  REPOSITORY_PATTERN,
  summarizeDependencyChanges,
  unavailableReason,
} from "#lib/github/dependencies";
import type { FetchLike } from "#lib/github/installation";

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
