import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "#lib/github/installation";
import type { Advisory } from "#lib/remediation/advisories";
import {
  compareVersions,
  fixedVersion,
  parsePurl,
  readAdvisories,
  versionsInSbom,
} from "#lib/remediation/advisories";

const advisory = (
  firstPatchedVersion: string | null,
  ghsa = "GHSA-aaaa-bbbb-cccc"
): Advisory => ({
  cve: "CVE-2026-0001",
  firstPatchedVersion,
  ghsa,
  severity: "high",
  summary: "Prototype pollution",
  url: `https://github.com/advisories/${ghsa}`,
  vulnerableRange: "< 4.17.21",
});

describe(parsePurl, () => {
  it("reads a scoped npm package", () => {
    expect(parsePurl("pkg:npm/%40babel/core@7.0.0")).toStrictEqual({
      ecosystem: "npm",
      name: "@babel/core",
      version: "7.0.0",
    });
  });

  it("joins a Maven group and artifact with a colon", () => {
    expect(
      parsePurl("pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1")
    ).toStrictEqual({
      ecosystem: "maven",
      name: "org.apache.logging.log4j:log4j-core",
      version: "2.14.1",
    });
  });

  it("keeps a Go module path and drops qualifiers", () => {
    expect(
      parsePurl("pkg:golang/github.com/gin-gonic/gin@v1.9.0?type=module")
    ).toStrictEqual({
      ecosystem: "go",
      name: "github.com/gin-gonic/gin",
      version: "v1.9.0",
    });
  });

  it("maps the ecosystems the advisory database renames", () => {
    expect(parsePurl("pkg:pypi/django@3.2.0")?.ecosystem).toBe("pip");
    expect(parsePurl("pkg:cargo/serde@1.0.0")?.ecosystem).toBe("rust");
    expect(parsePurl("pkg:gem/rails@7.0.0")?.ecosystem).toBe("rubygems");
  });

  it("refuses a purl it cannot place", () => {
    expect(parsePurl("pkg:unknown/thing@1.0.0")).toBeNull();
    expect(parsePurl("pkg:npm/lodash")).toBeNull();
    expect(parsePurl("not a purl")).toBeNull();
  });
});

const ref = (locator: string) => ({
  externalRefs: [{ referenceLocator: locator, referenceType: "purl" }],
});

describe(versionsInSbom, () => {
  it("returns each version of the package once", () => {
    const sbom = {
      sbom: {
        packages: [
          ref("pkg:npm/lodash@4.17.10"),
          ref("pkg:npm/lodash@4.17.10"),
          ref("pkg:npm/lodash@3.10.1"),
          ref("pkg:npm/zod@4.1.0"),
        ],
      },
    };
    expect(
      versionsInSbom(sbom, "lodash").map((entry) => entry.version)
    ).toStrictEqual(["4.17.10", "3.10.1"]);
  });
});

describe(compareVersions, () => {
  it("compares numerically, part by part", () => {
    expect(compareVersions("4.17.21", "4.17.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v2.0.0", "1.9.9")).toBe(1);
  });

  it("puts a release after its prerelease", () => {
    expect(compareVersions("2.0.0", "2.0.0-rc.1")).toBe(1);
    expect(compareVersions("2.0.0-alpha", "2.0.0-beta")).toBe(-1);
  });
});

describe(fixedVersion, () => {
  it("takes the highest first patched version", () => {
    expect(fixedVersion([advisory("4.17.12"), advisory("4.17.21")])).toBe(
      "4.17.21"
    );
  });

  it("answers null when an advisory has no patch", () => {
    expect(fixedVersion([advisory("4.17.21"), advisory(null)])).toBeNull();
  });
});

describe(readAdvisories, () => {
  it("asks the global database for the one version and keeps its package's patch", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      json: () =>
        Promise.resolve([
          {
            cve_id: null,
            ghsa_id: "GHSA-aaaa-bbbb-cccc",
            html_url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            severity: "high",
            summary: "Prototype pollution",
            vulnerabilities: [
              {
                first_patched_version: "4.17.21",
                package: { ecosystem: "npm", name: "lodash" },
                vulnerable_version_range: "< 4.17.21",
              },
            ],
          },
        ]),
      ok: true,
      status: 200,
    });
    const advisories = await readAdvisories({
      fetchImpl,
      resolved: { ecosystem: "npm", name: "lodash", version: "4.17.10" },
      token: "tok",
    });
    expect(advisories[0]?.firstPatchedVersion).toBe("4.17.21");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/advisories?affects=lodash%404.17.10&ecosystem=npm&per_page=100"
    );
  });
});
