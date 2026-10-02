import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "#lib/github/installation";
import type { TextFetch } from "#lib/remediation/lockfile";
import { isTask, resolveTask, upgradeTarget } from "#lib/remediation/task";

const ok = <T extends object>(body: T) =>
  Promise.resolve({ json: () => Promise.resolve(body), ok: true, status: 200 });

const notFound = () =>
  Promise.resolve({ json: () => Promise.resolve({}), ok: false, status: 404 });

const sbom = (...locators: readonly string[]) => ({
  sbom: {
    packages: locators.map((locator) => ({
      externalRefs: [{ referenceLocator: locator, referenceType: "purl" }],
    })),
  },
});

const lodashAdvisory = {
  cve_id: "CVE-2021-23337",
  ghsa_id: "GHSA-35jh-r3h4-6jhm",
  html_url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
  severity: "high",
  summary: "Command injection in template",
  vulnerabilities: [
    {
      first_patched_version: "4.17.21",
      package: { ecosystem: "npm", name: "lodash" },
      vulnerable_version_range: "< 4.17.21",
    },
  ],
};

/** GitHub as the task resolver sees it: repo, head, SBOM, advisories. */
const github = (overrides: { sbom?: object; advisories?: object } = {}) =>
  vi.fn<FetchLike>((url) => {
    if (url.endsWith("/repos/acme/widgets")) {
      return ok({ default_branch: "main" });
    }
    if (url.includes("/commits/main")) {
      return ok({ sha: "abc1234" });
    }
    if (url.endsWith("/dependency-graph/sbom")) {
      return ok(overrides.sbom ?? sbom("pkg:npm/lodash@4.17.10"));
    }
    if (url.includes("/advisories?")) {
      return ok(overrides.advisories ?? [lodashAdvisory]);
    }
    return notFound();
  });

/** No lockfile at the root, so the resolver falls back to the SBOM. */
const noLockfile: TextFetch = () =>
  Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });

const resolve = (
  fetchImpl: FetchLike,
  packageName = "lodash",
  textFetchImpl: TextFetch = noLockfile
) =>
  resolveTask({
    fetchImpl,
    packageName,
    repository: "acme/widgets",
    textFetchImpl,
    token: "tok",
  });

describe(resolveTask, () => {
  it("builds the task from the default branch, the SBOM and the advisories", async () => {
    const task = await resolve(github());
    expect(isTask(task)).toBeTruthy();
    expect(task).toMatchObject({
      baseSha: "abc1234",
      defaultBranch: "main",
      ecosystem: "npm",
      fixedVersion: "4.17.21",
      packageName: "lodash",
      repository: "acme/widgets",
    });
  });

  it("refuses a package the dependency graph does not list", async () => {
    const task = await resolve(github(), "left-pad");
    expect(task).toStrictEqual({
      reason: "left-pad is not in acme/widgets's lockfile or dependency graph.",
    });
  });

  it("refuses when no advisory affects the versions in use", async () => {
    const task = await resolve(github({ advisories: [] }));
    expect(isTask(task)).toBeFalsy();
  });

  it("refuses when the dependency graph is off", async () => {
    const fetchImpl = github();
    fetchImpl.mockImplementation((url, init) =>
      url.endsWith("/dependency-graph/sbom") ? notFound() : github()(url, init)
    );
    const task = await resolve(fetchImpl);
    expect(isTask(task)).toBeFalsy();
  });

  it("reads the installed version from bun.lock before the SBOM", async () => {
    const bunLock =
      '  "packages": {\n    "lodash": ["lodash@4.17.10", "", {}, "sha512-x"],\n  }';
    const fetchImpl = github({ sbom: sbom("pkg:npm/lodash@%5E4.17.0") });
    const task = await resolve(fetchImpl, "lodash", (url) =>
      Promise.resolve(
        url.includes("/contents/bun.lock?")
          ? { ok: true, status: 200, text: () => Promise.resolve(bunLock) }
          : { ok: false, status: 404, text: () => Promise.resolve("") }
      )
    );
    expect(task).toMatchObject({
      fixedVersion: "4.17.21",
      vulnerable: [{ version: "4.17.10" }],
    });
    expect(
      fetchImpl.mock.calls.some(([url]) =>
        url.endsWith("/dependency-graph/sbom")
      )
    ).toBeFalsy();
  });

  it("refuses an SBOM that lists only ranges", async () => {
    const task = await resolve(
      github({ sbom: sbom("pkg:npm/lodash@%5E4.17.0") })
    );
    expect(task).toStrictEqual({
      reason:
        "The dependency graph lists only version ranges for lodash (^4.17.0), and no lockfile it reads says what is installed.",
    });
  });
});

const entry = (version: string, patched: string) => ({
  advisories: [
    {
      cve: null,
      firstPatchedVersion: patched,
      ghsa: `GHSA-${patched}`,
      severity: "high",
      summary: "",
      url: "",
      vulnerableRange: "",
    },
  ],
  version,
});

describe(upgradeTarget, () => {
  it("takes the highest patch when it is newer than every version in use", () => {
    expect(upgradeTarget([entry("8.9.0", "8.10.2")])).toBe("8.10.2");
  });

  it("refuses a patch that would be a downgrade", () => {
    expect(upgradeTarget([entry("8.9.0", "7.29.1")])).toBeNull();
  });
});
