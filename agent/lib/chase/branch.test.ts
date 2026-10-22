import { describe, expect, it } from "vitest";

import {
  CHASE_BRANCH_PREFIX,
  chaseBranchName,
  fallBackToPullRequest,
  planPush,
} from "#lib/chase/branch";
import type { BranchFacts } from "#lib/chase/branch";

const facts = (overrides: Partial<BranchFacts> = {}): BranchFacts => ({
  baseRepository: "acme/widgets",
  canWrite: true,
  defaultBranch: "main",
  headProtected: false,
  headRef: "feat/thing",
  headRepository: "acme/widgets",
  headSha: "abc1234def5678",
  pullRequest: 42,
  ...overrides,
});

describe(chaseBranchName, () => {
  it("names the pull request and the head it fixed under baymi/chase/", () => {
    expect(chaseBranchName(42, "abc1234def5678")).toBe(
      "baymi/chase/42-abc1234"
    );
    expect(chaseBranchName(42, "abc1234def5678")).toMatch(
      new RegExp(`^${CHASE_BRANCH_PREFIX}`, "u")
    );
  });
});

describe(planPush, () => {
  it("pushes to the head branch of a same-repository pull request it can write", () => {
    expect(planPush(facts())).toStrictEqual({
      branch: "feat/thing",
      kind: "push",
    });
    expect(planPush(facts({ headRepository: "ACME/Widgets" }))).toStrictEqual({
      branch: "feat/thing",
      kind: "push",
    });
  });

  it("refuses a fork, and a fork whose repository is gone", () => {
    expect(
      planPush(facts({ headRepository: "stranger/widgets" }))
    ).toStrictEqual({ kind: "refuse", reason: "fork" });
    expect(planPush(facts({ headRepository: null }))).toStrictEqual({
      kind: "refuse",
      reason: "fork",
    });
  });

  it("refuses a repository the App cannot write", () => {
    expect(planPush(facts({ canWrite: false }))).toStrictEqual({
      kind: "refuse",
      reason: "no-write",
    });
  });

  it("opens a pull request against a protected head branch or the default branch", () => {
    const expected = {
      base: "feat/thing",
      branch: "baymi/chase/42-abc1234",
      kind: "pull-request",
    };
    expect(planPush(facts({ headProtected: true }))).toStrictEqual(expected);
    expect(planPush(facts({ defaultBranch: "feat/thing" }))).toStrictEqual(
      expected
    );
    expect(fallBackToPullRequest(facts())).toStrictEqual(expected);
  });
});
