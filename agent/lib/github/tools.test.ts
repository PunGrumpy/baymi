import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  GITHUB_CI_READS,
  GITHUB_CI_TOOLS,
  GITHUB_TOOLS,
  GITHUB_WRITES,
  toolsForTurn,
} from "#lib/github/tools";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

describe("the mounted GitHub tool set", () => {
  it("mounts no tool twice", () => {
    expect(new Set(GITHUB_TOOLS).size).toBe(GITHUB_TOOLS.length);
  });

  it("mounts exactly these tools, so a change to the list is a visible diff", () => {
    expect(new Set<string>(GITHUB_TOOLS)).toStrictEqual(
      new Set([
        "addIssueComment",
        "addPullRequestComment",
        "createIssue",
        "getCiFailureContext",
        "getCombinedStatus",
        "getFileContent",
        "getIssueContext",
        "getPullRequestContext",
        "getWorkflowJobLogs",
        "listCheckRuns",
        "listPullRequestFiles",
        "listPullRequestReviewThreads",
        "listPullRequests",
        "listWorkflowJobs",
        "listWorkflowRuns",
        "replyToReviewComment",
        "rerunWorkflowRun",
        "searchCode",
        "searchIssues",
      ])
    );
  });

  it("never mounts a merge: that click is the maintainer's", () => {
    expect(GITHUB_TOOLS).not.toContain("mergePullRequest");
  });

  it("mounts nothing that could change a repository's code or verdict", () => {
    // The agent reads and speaks. It never edits files through the API,
    // never approves or requests changes, never labels or closes, and never
    // stops or starts CI.
    for (const forbidden of [
      "addAssignees",
      "addLabels",
      "cancelWorkflowRun",
      "closeIssue",
      "createBranch",
      "createOrUpdateFile",
      "createPullRequest",
      "createPullRequestReview",
      "deleteBranch",
      "mergePullRequest",
      "triggerWorkflow",
      "updatePullRequest",
    ]) {
      expect(GITHUB_TOOLS).not.toContain(forbidden);
    }
  });

  it("keeps the writes to what a companion needs to answer elsewhere, plus one rerun", () => {
    expect([...GITHUB_WRITES]).toStrictEqual([
      "addIssueComment",
      "addPullRequestComment",
      "createIssue",
      "replyToReviewComment",
      "rerunWorkflowRun",
    ]);
  });

  it("keeps the CI tools to reads, apart from the writes", () => {
    expect([...GITHUB_CI_READS]).toStrictEqual([
      "getCiFailureContext",
      "getCombinedStatus",
      "getWorkflowJobLogs",
      "listCheckRuns",
      "listWorkflowJobs",
      "listWorkflowRuns",
      "searchIssues",
    ]);
    for (const read of GITHUB_CI_READS) {
      expect(GITHUB_WRITES).not.toContain(read);
    }
  });
});

const principal = (
  overrides: Partial<SessionAuthContext>
): SessionAuthContext => ({
  attributes: {},
  authenticator: "github-webhook",
  principalId: "github:42",
  principalType: "user",
  ...overrides,
});

describe(toolsForTurn, () => {
  const mounted = Object.fromEntries(
    GITHUB_TOOLS.map((name) => [name, { name }])
  );

  it("names every CI tool, the rerun included, and no other", () => {
    expect(new Set(GITHUB_CI_TOOLS)).toStrictEqual(
      new Set([
        "getCiFailureContext",
        "getCombinedStatus",
        "getWorkflowJobLogs",
        "listCheckRuns",
        "listWorkflowJobs",
        "listWorkflowRuns",
        "rerunWorkflowRun",
        "searchIssues",
      ])
    );
  });

  it("takes every CI tool out of a review turn and leaves the rest", () => {
    const offered = Object.keys(
      toolsForTurn(mounted, principal({ principalId: REVIEWER_PRINCIPAL }))
    );
    expect(offered).toHaveLength(GITHUB_TOOLS.length - GITHUB_CI_TOOLS.length);
    for (const name of GITHUB_CI_TOOLS) {
      expect(offered).not.toContain(name);
    }
    expect(offered).toContain("getPullRequestContext");
    expect(offered).toContain("addPullRequestComment");
  });

  it("offers everything to the maintainer", () => {
    expect(Object.keys(toolsForTurn(mounted, principal({})))).toStrictEqual(
      Object.keys(mounted)
    );
  });

  it("offers everything to the app's own scheduled turn, which reads CI", () => {
    const scheduled = principal({
      authenticator: "app",
      principalId: "eve:app",
      principalType: "runtime",
    });
    expect(Object.keys(toolsForTurn(mounted, scheduled))).toStrictEqual(
      Object.keys(mounted)
    );
  });

  it("offers everything when there is no principal to withhold from", () => {
    expect(Object.keys(toolsForTurn(mounted, null))).toStrictEqual(
      Object.keys(mounted)
    );
  });
});
