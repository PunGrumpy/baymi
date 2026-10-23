import { describe, expect, it } from "vitest";

import { refusedResult } from "#lib/chase/result";
import { endChase, initialChaseState, recordRun } from "#lib/chase/state";

const run = (digest: string, exitCode: number) => ({
  changeDigest: digest,
  results: [{ exitCode, name: "test", output: "" }],
  treeBefore: digest,
});

describe(initialChaseState, () => {
  it("starts with nothing checked out, run or decided", () => {
    expect(initialChaseState()).toStrictEqual({
      baseline: null,
      checkRuns: 0,
      cleanTree: "",
      latest: null,
      packageManager: null,
      result: null,
      startedAt: null,
      task: null,
    });
  });
});

describe(recordRun, () => {
  it("keeps the first run as the reproduction and every later one as the latest", () => {
    let state = initialChaseState();
    for (const [index, exitCode] of [1, 1, 0].entries()) {
      state = recordRun(state, run(`d${index}`, exitCode));
    }
    expect(state.baseline?.changeDigest).toBe("d0");
    expect(state.latest?.changeDigest).toBe("d2");
    expect(state.checkRuns).toBe(3);
  });
});

const refused = (reason: string) =>
  refusedResult({
    headSha: "abc",
    pullRequest: "https://github.com/PunGrumpy/baymi/pull/1",
    reason,
  });

describe(endChase, () => {
  it("records the first outcome and keeps it", () => {
    const first = endChase(initialChaseState(), refused("first"));
    const second = endChase(first, refused("second"));
    expect(first.result?.reason).toBe("first");
    expect(second.result?.reason).toBe("first");
  });
});
