import { describe, expect, it } from "vitest";

import { checksOf, fixPullRequestBody, stopResult } from "#lib/chase/report";
import { initialChaseState, recordRun } from "#lib/chase/state";
import type { ChaseState } from "#lib/chase/state";

const passed = { exitCode: 0, name: "typecheck", output: "" };
const failed = { exitCode: 1, name: "test", output: "expected 5, got 2" };

const task = {
  headRef: "feat/sum",
  headSha: "abc1234def5678",
  pullRequest: 42,
  repository: "PunGrumpy/baymi",
  url: "https://github.com/PunGrumpy/baymi/pull/42",
};

const ran = (...runs: (typeof passed)[][]): ChaseState => {
  let state: ChaseState = { ...initialChaseState(), task };
  for (const [index, results] of runs.entries()) {
    state = recordRun(state, {
      changeDigest: `d${index}`,
      results,
      treeBefore: `d${index}`,
    });
  }
  return state;
};

describe(stopResult, () => {
  it("reports a fix the checks did not pass, with the failing output", () => {
    const result = stopResult({
      budgetSpent: false,
      reason: "the second attempt still fails",
      state: ran([passed, failed], [passed, failed]),
    });
    expect(result).toMatchObject({
      checks: [
        { exitCode: 0, name: "typecheck", passed: true },
        { exitCode: 1, name: "test", passed: false },
      ],
      commits: [],
      headSha: task.headSha,
      notVerified: ["No fix was pushed."],
      pullRequest: task.url,
      reason: "the second attempt still fails",
      status: "failed",
    });
    expect(result.output).toContain("$ test (exit 1)\nexpected 5, got 2");
  });

  it("tells a failure that did not reproduce from one that ran out of time", () => {
    expect(
      stopResult({ budgetSpent: false, reason: "", state: ran([passed]) })
    ).toMatchObject({
      reason: "The chase stopped without a fix.",
      status: "not-reproduced",
    });
    expect(
      stopResult({
        budgetSpent: true,
        reason: "out of time",
        state: ran([failed]),
      }).status
    ).toBe("partial");
    expect(
      stopResult({
        budgetSpent: false,
        reason: "no toolchain",
        state: initialChaseState(),
      }).status
    ).toBe("failed");
  });
});

describe(fixPullRequestBody, () => {
  it("shows the checks before and after and the commits", () => {
    const body = fixPullRequestBody({
      baseline: { changeDigest: "d0", results: [failed], treeBefore: "d0" },
      latest: { changeDigest: "d1", results: [passed], treeBefore: "d1" },
      messages: ["fix(math): add both operands\n\nbody"],
      task,
    });
    expect(body).toContain("- `test`: exited with 1");
    expect(body).toContain("- `typecheck`: passed");
    expect(body).toContain("- fix(math): add both operands");
    expect(checksOf(null)).toStrictEqual([]);
  });
});
