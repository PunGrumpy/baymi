import type { GitHubPullRequestEvent } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  followUpContext,
  isUnattendedReviewState,
  pullRequestFromAuth,
  shouldReviewPullRequest,
} from "#lib/github/pull-requests";

const human = { login: "sam", type: "User" };

type Raw = GitHubPullRequestEvent["raw"];

/** `raw` is the pull request itself, the way eve hands it to the handler. */
const event = (
  action: string,
  draft?: boolean
): Pick<GitHubPullRequestEvent, "action" | "raw"> => {
  const raw: Raw = draft === undefined ? { number: 7 } : { draft, number: 7 };
  return { action, raw };
};

const auth = (
  attributes: SessionAuthContext["attributes"]
): SessionAuthContext => ({
  attributes,
  authenticator: "github-webhook",
  principalId: "github:baymiai",
  principalType: "service",
});

describe(shouldReviewPullRequest, () => {
  it("reviews a pull request when it opens, becomes ready, or is pushed to", () => {
    for (const action of ["opened", "ready_for_review", "synchronize"]) {
      expect(
        shouldReviewPullRequest(event(action), human, "baymiai")
      ).toBeTruthy();
    }
  });

  it("skips a draft, pushes to one included, and every other action", () => {
    expect(
      shouldReviewPullRequest(event("opened", true), human, "baymiai")
    ).toBeFalsy();
    expect(
      shouldReviewPullRequest(event("synchronize", true), human, "baymiai")
    ).toBeFalsy();
    for (const action of ["closed", "edited", "labeled", "reopened"]) {
      expect(
        shouldReviewPullRequest(event(action), human, "baymiai")
      ).toBeFalsy();
    }
  });

  it("skips pull requests opened by bots, its own included", () => {
    expect(
      shouldReviewPullRequest(
        event("opened"),
        { login: "dependabot[bot]", type: "Bot" },
        "baymiai"
      )
    ).toBeFalsy();
    expect(
      shouldReviewPullRequest(
        event("opened"),
        { login: "baymiai[bot]", type: "User" },
        "baymiai"
      )
    ).toBeFalsy();
  });

  it("reviews when the payload does not say whether it is a draft", () => {
    expect(
      shouldReviewPullRequest({ action: "opened", raw: {} }, human, "baymiai")
    ).toBeTruthy();
  });
});

describe(followUpContext, () => {
  it("tells a review after a push that it is a follow-up, with the new head", () => {
    expect(
      followUpContext({ action: "synchronize", headSha: "abc123" })
    ).toStrictEqual([
      "New commits were pushed to this pull request, and this is a follow-up review. The head is now abc123.",
    ]);
    expect(
      followUpContext({ action: "synchronize", headSha: null })
    ).toStrictEqual([
      "New commits were pushed to this pull request, and this is a follow-up review.",
    ]);
  });

  it("adds nothing to a first review", () => {
    for (const action of ["opened", "ready_for_review"]) {
      expect(followUpContext({ action, headSha: "abc123" })).toBeUndefined();
    }
  });
});

describe(isUnattendedReviewState, () => {
  it("recognizes a session that started from a pull request event", () => {
    expect(
      isUnattendedReviewState({
        pullRequestNumber: 12,
        reviewCommentId: null,
        triggeringCommentId: null,
      })
    ).toBeTruthy();
  });

  it("does not mistake a mention on a pull request for a review", () => {
    expect(
      isUnattendedReviewState({
        pullRequestNumber: 12,
        reviewCommentId: null,
        triggeringCommentId: 99,
      })
    ).toBeFalsy();
    expect(
      isUnattendedReviewState({
        pullRequestNumber: 12,
        reviewCommentId: 7,
        triggeringCommentId: null,
      })
    ).toBeFalsy();
  });

  it("does not match an issue session", () => {
    expect(
      isUnattendedReviewState({
        pullRequestNumber: null,
        reviewCommentId: null,
        triggeringCommentId: null,
      })
    ).toBeFalsy();
  });
});

describe(pullRequestFromAuth, () => {
  it("reads the pull request the channel stamped on the auth", () => {
    expect(
      pullRequestFromAuth(
        auth({ pull_request_number: "12", repository: "acme/widgets" })
      )
    ).toStrictEqual({
      number: 12,
      repository: "acme/widgets",
      url: "https://github.com/acme/widgets/pull/12",
    });
  });

  it("answers null off an issue session or a malformed attribute", () => {
    expect(
      pullRequestFromAuth(
        auth({ pull_request_number: "", repository: "acme/widgets" })
      )
    ).toBeNull();
    expect(
      pullRequestFromAuth(
        auth({ pull_request_number: "12", repository: "widgets" })
      )
    ).toBeNull();
    expect(
      pullRequestFromAuth(
        auth({ pull_request_number: ["12"], repository: "acme/widgets" })
      )
    ).toBeNull();
    expect(pullRequestFromAuth(null)).toBeNull();
  });
});
