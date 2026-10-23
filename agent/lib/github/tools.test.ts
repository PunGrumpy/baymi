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

/** What `defaultGitHubAuth` mints for `login` on a repository `owner` owns. */
const gitHubPerson = (login: string, owner = "PunGrumpy") =>
  principal({
    attributes: { repository: `${owner}/baymi`, user_login: login },
    issuer: `github:${owner}`,
    subject: login,
  });

describe(toolsForTurn, () => {
  const mounted = Object.fromEntries(
    GITHUB_TOOLS.map((name) => [name, { name }])
  );
  const original = GITHUB_TOOLS.length - GITHUB_CI_TOOLS.length;

  const reviewer = principal({
    principalId: REVIEWER_PRINCIPAL,
    principalType: "service",
  });
  const app = principal({
    authenticator: "app",
    principalId: "eve:app",
    principalType: "runtime",
  });
  // A service the agent has no class for, such as a project-minted OIDC token.
  const unknown = principal({
    authenticator: "oidc",
    principalId: "https://oidc.vercel.com/baymi:project:baymi",
    principalType: "service",
  });

  const offeredTo = (auth: SessionAuthContext | null) =>
    Object.keys(toolsForTurn(mounted, auth));

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
    const offered = offeredTo(reviewer);
    expect(offered).toHaveLength(original);
    for (const name of GITHUB_CI_TOOLS) {
      expect(offered).not.toContain(name);
    }
    expect(offered).toContain("getPullRequestContext");
    expect(offered).toContain("addPullRequestComment");
  });

  it("offers everything to the maintainer", () => {
    expect(offeredTo(gitHubPerson("PunGrumpy"))).toStrictEqual(
      Object.keys(mounted)
    );
  });

  it("offers everything to the app's own scheduled turn, which reads CI", () => {
    expect(offeredTo(app)).toStrictEqual(Object.keys(mounted));
  });

  it("offers everything to a collaborator the mention gate admitted", () => {
    expect(offeredTo(gitHubPerson("octocat"))).toStrictEqual(
      Object.keys(mounted)
    );
  });

  it("offers the original eleven to a caller nobody recognizes", () => {
    // The cut is an allowlist: what the classifier does not name sees no logs.
    expect(offeredTo(unknown)).toHaveLength(original);
    for (const name of GITHUB_CI_TOOLS) {
      expect(offeredTo(unknown)).not.toContain(name);
    }
  });

  it("offers the original eleven when there is no principal at all", () => {
    expect(offeredTo(null)).toHaveLength(original);
    for (const name of GITHUB_CI_TOOLS) {
      expect(offeredTo(null)).not.toContain(name);
    }
  });
});
