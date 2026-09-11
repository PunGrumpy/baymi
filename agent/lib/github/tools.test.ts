import { describe, expect, it } from "vitest";

import { GITHUB_TOOLS, GITHUB_WRITES } from "#lib/github/tools";

describe("the mounted GitHub tool set", () => {
  it("mounts no tool twice", () => {
    expect(new Set(GITHUB_TOOLS).size).toBe(GITHUB_TOOLS.length);
  });

  it("mounts nothing that could change a repository's code or verdict", () => {
    // The agent reads and speaks. It never edits files through the API,
    // never approves or requests changes, and never labels or closes.
    for (const forbidden of [
      "createOrUpdateFile",
      "createPullRequestReview",
      "mergePullRequest",
      "closeIssue",
      "addLabels",
      "addAssignees",
    ]) {
      expect(GITHUB_TOOLS).not.toContain(forbidden);
    }
  });

  it("keeps the writes to what a companion needs to answer elsewhere", () => {
    expect([...GITHUB_WRITES]).toStrictEqual([
      "addIssueComment",
      "addPullRequestComment",
      "createIssue",
      "replyToReviewComment",
    ]);
  });
});
