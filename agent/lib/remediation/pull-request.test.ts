import { describe, expect, it } from "vitest";

import {
  REMEDIATION_MARKER,
  remediationBody,
  remediationTitle,
} from "#lib/remediation/pull-request";
import type { RemediationTask } from "#lib/remediation/task";

const task: RemediationTask = {
  baseSha: "abc1234def",
  defaultBranch: "main",
  ecosystem: "npm",
  fixedVersion: "4.17.21",
  packageName: "lodash",
  repository: "acme/widgets",
  vulnerable: [
    {
      advisories: [
        {
          cve: "CVE-2021-23337",
          firstPatchedVersion: "4.17.21",
          ghsa: "GHSA-35jh-r3h4-6jhm",
          severity: "high",
          summary: "Command injection in template",
          url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
          vulnerableRange: "< 4.17.21",
        },
      ],
      version: "4.17.10",
    },
  ],
};

describe(remediationTitle, () => {
  it("names the package and both versions", () => {
    expect(remediationTitle(task)).toBe(
      "fix(deps): bump lodash from 4.17.10 to 4.17.21"
    );
  });
});

describe(remediationBody, () => {
  it("leads with the verdict and cites each advisory", () => {
    const body = remediationBody({
      notes: "",
      results: [{ exitCode: 0, name: "test", output: "" }],
      task,
      verdict: { reasons: [], verified: true },
    });
    expect(body.startsWith(REMEDIATION_MARKER)).toBeTruthy();
    expect(body).toContain("Verified: the project's checks passed");
    expect(body).toContain("[GHSA-35jh-r3h4-6jhm]");
    expect(body).toContain("(CVE-2021-23337)");
    expect(body).toContain("Bumped lodash to 4.17.21.");
  });

  it("calls an unverified fix a mitigation and shows the failing output", () => {
    const body = remediationBody({
      notes: "Replaced the removed `_.template` option.",
      results: [{ exitCode: 1, name: "typecheck", output: "TS2345: bad" }],
      task,
      verdict: { reasons: ["typecheck exited with 1."], verified: false },
    });
    expect(body).toContain("Unverified mitigation");
    expect(body).toContain("- typecheck exited with 1.");
    expect(body).toContain("TS2345: bad");
    expect(body).toContain("Replaced the removed `_.template` option.");
  });
});
