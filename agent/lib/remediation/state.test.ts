import { describe, expect, it } from "vitest";

import { initialRemediationState } from "#lib/remediation/state";

describe(initialRemediationState, () => {
  it("starts with no task, no checks and nothing submitted", () => {
    expect(initialRemediationState()).toStrictEqual({
      checkRuns: 0,
      checks: null,
      packageManager: null,
      pullRequestUrl: null,
      task: null,
    });
  });
});
