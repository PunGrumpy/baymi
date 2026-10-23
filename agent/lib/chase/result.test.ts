import { describe, expect, it } from "vitest";

import {
  CHASE_RESULT,
  CHASE_RESULT_JSON_SCHEMA,
  isFixed,
  lostResult,
  refusedResult,
  witnessResult,
} from "#lib/chase/result";
import type { ChaseResult } from "#lib/chase/result";

const PR = "https://github.com/acme/widgets/pull/42";

const pushed: ChaseResult = {
  branch: "feat/thing",
  checks: [
    { exitCode: 0, name: "install", passed: true },
    { exitCode: 0, name: "test", passed: true },
  ],
  commits: ["c1", "c2"],
  fixPullRequest: null,
  headSha: "h0",
  notVerified: [],
  output: "",
  pullRequest: PR,
  reason: "test failed on sum; fixed and pushed.",
  status: "pushed",
};

describe("the result's schema", () => {
  it("reads a result back and refuses anything else", () => {
    expect(CHASE_RESULT.safeParse(structuredClone(pushed)).data).toStrictEqual(
      pushed
    );
    expect(
      CHASE_RESULT.safeParse({ ...pushed, status: "merged" }).success
    ).toBeFalsy();
  });

  it("describes every field to the subagent, and requires each", () => {
    const fields = new Set(Object.keys(CHASE_RESULT.shape));
    expect(
      new Set(Object.keys(CHASE_RESULT_JSON_SCHEMA.properties))
    ).toStrictEqual(fields);
    expect(new Set(CHASE_RESULT_JSON_SCHEMA.required)).toStrictEqual(fields);
  });
});

describe(isFixed, () => {
  it("counts a push and a fix pull request, and nothing else", () => {
    expect(isFixed(pushed)).toBeTruthy();
    expect(isFixed({ ...pushed, status: "opened-pull-request" })).toBeTruthy();
    for (const status of [
      "failed",
      "not-reproduced",
      "partial",
      "refused",
      "superseded",
    ] as const) {
      expect(isFixed({ ...pushed, status })).toBeFalsy();
    }
  });
});

describe(witnessResult, () => {
  it("keeps a push GitHub shows as the head", () => {
    expect(witnessResult(pushed, "c2")).toStrictEqual(pushed);
  });

  it("turns a push GitHub does not show into a failure", () => {
    const witnessed = witnessResult(pushed, "h0");
    expect(witnessed.status).toBe("failed");
    expect(witnessed.reason).toBe(
      "The chase reported pushing c2, and the pull request's head is h0."
    );
    expect(witnessed.notVerified).toContain(
      "GitHub does not show the push the chase reported."
    );
    expect(witnessResult({ ...pushed, commits: [] }, null).status).toBe(
      "failed"
    );
  });

  it("passes every other outcome through", () => {
    const failed = { ...pushed, commits: [], status: "failed" as const };
    expect(witnessResult(failed, "anything")).toStrictEqual(failed);
  });
});

describe("results built without a subagent", () => {
  it("say why nothing ran", () => {
    expect(
      refusedResult({ headSha: "h0", pullRequest: PR, reason: "fork" })
    ).toMatchObject({
      checks: [],
      commits: [],
      reason: "fork",
      status: "refused",
    });
    expect(
      lostResult({ headSha: "h0", pullRequest: PR, why: "session failed" })
    ).toMatchObject({ reason: "session failed", status: "failed" });
  });
});
