import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "#lib/github/installation";
import { listInstalledRepositories } from "#lib/github/installation";

const page = (
  repositories: readonly { full_name: string; private?: boolean }[],
  total: number
) => ({
  json: () =>
    Promise.resolve({
      repositories: repositories.map((repository) => ({
        archived: false,
        default_branch: "main",
        full_name: repository.full_name,
        private: repository.private ?? false,
      })),
      total_count: total,
    }),
  ok: true,
  status: 200,
});

describe(listInstalledRepositories, () => {
  it("reads the installation's repositories with the token", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(
        page([{ full_name: "acme/widgets", private: true }], 1)
      );
    const repositories = await listInstalledRepositories("tok", fetchImpl);
    expect(repositories).toStrictEqual([
      {
        archived: false,
        defaultBranch: "main",
        fullName: "acme/widgets",
        private: true,
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toContain("/installation/repositories?per_page=100&page=1");
    expect(init?.headers.authorization).toBe("Bearer tok");
  });

  it("follows the pages until the total is in hand", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(page([{ full_name: "acme/a" }], 2))
      .mockResolvedValueOnce(page([{ full_name: "acme/b" }], 2));
    const repositories = await listInstalledRepositories("tok", fetchImpl);
    expect(repositories.map((repository) => repository.fullName)).toStrictEqual(
      ["acme/a", "acme/b"]
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops on an empty page rather than trusting the total", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(page([{ full_name: "acme/a" }], 5))
      .mockResolvedValueOnce(page([], 5));
    await expect(
      listInstalledRepositories("tok", fetchImpl)
    ).resolves.toHaveLength(1);
  });

  it("fails loudly on a non-2xx answer", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      json: () => Promise.resolve({}),
      ok: false,
      status: 401,
    });
    await expect(listInstalledRepositories("tok", fetchImpl)).rejects.toThrow(
      "401"
    );
  });
});
