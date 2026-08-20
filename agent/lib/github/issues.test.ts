import type { GitHubIssueEvent } from "eve/channels/github";
import { describe, expect, it } from "vitest";

import { isAutonomousTriageState, shouldTriageIssue } from "#lib/github/issues";

const BOT = "baymiai";

const issue = (
  overrides: {
    readonly action?: GitHubIssueEvent["action"];
    readonly association?: string;
  } = {}
): Pick<GitHubIssueEvent, "action" | "raw"> => ({
  action: overrides.action ?? "opened",
  raw: { author_association: overrides.association ?? "NONE" },
});

describe(shouldTriageIssue, () => {
  it("triages a new issue from someone outside the repository", () => {
    expect(shouldTriageIssue(issue(), "a-stranger", BOT)).toBeTruthy();
  });

  it("ignores anything but a freshly opened issue", () => {
    expect(
      shouldTriageIssue(issue({ action: "edited" }), "a-stranger", BOT)
    ).toBeFalsy();
    expect(
      shouldTriageIssue(issue({ action: "closed" }), "a-stranger", BOT)
    ).toBeFalsy();
  });

  it("leaves a maintainer's own issue alone", () => {
    // They can mention the agent if they want it; an issue they filed is a
    // note to themselves.
    expect(
      shouldTriageIssue(issue({ association: "OWNER" }), "pungrumpy", BOT)
    ).toBeFalsy();
    expect(
      shouldTriageIssue(issue({ association: "MEMBER" }), "someone", BOT)
    ).toBeFalsy();
  });

  it("never answers itself or another bot", () => {
    expect(shouldTriageIssue(issue(), BOT, BOT)).toBeFalsy();
    expect(shouldTriageIssue(issue(), "BaymiAI", BOT)).toBeFalsy();
    expect(shouldTriageIssue(issue(), "dependabot[bot]", BOT)).toBeFalsy();
  });

  it("treats a contributor as outside: they still need an answer", () => {
    expect(
      shouldTriageIssue(
        issue({ association: "CONTRIBUTOR" }),
        "past-helper",
        BOT
      )
    ).toBeTruthy();
  });
});

describe(isAutonomousTriageState, () => {
  it("recognizes a session that started from an issue, not a comment", () => {
    expect(
      isAutonomousTriageState({ issueNumber: 12, triggeringCommentId: null })
    ).toBeTruthy();
  });

  it("does not mistake a mention for one", () => {
    expect(
      isAutonomousTriageState({ issueNumber: 12, triggeringCommentId: 99 })
    ).toBeFalsy();
  });

  it("does not mistake a pull request session for one", () => {
    expect(
      isAutonomousTriageState({ issueNumber: null, triggeringCommentId: null })
    ).toBeFalsy();
  });
});
