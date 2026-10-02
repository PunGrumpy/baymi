import { describe, expect, it, vi } from "vitest";

import type { ArchiveFetch } from "#lib/remediation/archive";
import { downloadArchive, MAX_ARCHIVE_BYTES } from "#lib/remediation/archive";

const response = (bytes: number, declared?: number, status = 200) => ({
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
  headers: {
    get: (name: string) =>
      name === "content-length" && declared !== undefined
        ? String(declared)
        : null,
  },
  ok: status === 200,
  status,
});

describe(downloadArchive, () => {
  it("downloads the tarball at the commit with the token", async () => {
    const fetchImpl = vi.fn<ArchiveFetch>().mockResolvedValue(response(16));
    const bytes = await downloadArchive({
      fetchImpl,
      repository: "acme/widgets",
      sha: "abc1234",
      token: "tok",
    });
    expect(bytes.byteLength).toBe(16);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/acme/widgets/tarball/abc1234"
    );
    expect(fetchImpl.mock.calls[0]?.[1].headers.authorization).toBe(
      "Bearer tok"
    );
  });

  it("refuses an archive past the limit before reading it", async () => {
    const fetchImpl = vi
      .fn<ArchiveFetch>()
      .mockResolvedValue(response(0, MAX_ARCHIVE_BYTES + 1));
    await expect(
      downloadArchive({
        fetchImpl,
        repository: "acme/widgets",
        sha: "a",
        token: "t",
      })
    ).rejects.toThrow("larger than the archive limit");
  });

  it("throws when GitHub will not serve it", async () => {
    const fetchImpl = vi
      .fn<ArchiveFetch>()
      .mockResolvedValue(response(0, 0, 404));
    await expect(
      downloadArchive({
        fetchImpl,
        repository: "acme/widgets",
        sha: "a",
        token: "t",
      })
    ).rejects.toThrow("GitHub answered 404");
  });
});
