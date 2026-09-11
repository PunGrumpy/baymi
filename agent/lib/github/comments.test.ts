import type { GitHubComment } from "eve/channels/github";
import { describe, expect, it } from "vitest";

import {
  BOT_NAME,
  isBotLogin,
  isIgnoredComment,
  mentionPattern,
  shouldDispatchComment,
} from "#lib/github/comments";

interface CommentOverrides {
  readonly association?: string;
  readonly authorLogin?: string;
  readonly authorType?: string;
  readonly body?: string;
  readonly withoutAuthor?: boolean;
}

const comment = (overrides: CommentOverrides = {}): GitHubComment => {
  const {
    association = "OWNER",
    authorLogin = "sam",
    authorType = "User",
    body = `@${BOT_NAME} is the token handling in #12 safe?`,
    withoutAuthor = false,
  } = overrides;
  return {
    author: withoutAuthor
      ? undefined
      : {
          htmlUrl: undefined,
          id: 1,
          login: authorLogin,
          type: authorType,
          url: undefined,
        },
    body,
    htmlUrl: undefined,
    id: 1,
    raw: { author_association: association },
    url: undefined,
  };
};

describe(mentionPattern, () => {
  it("matches the mention on a word boundary", () => {
    const pattern = mentionPattern("baymiai");
    expect(pattern.test("@baymiai can you look at this?")).toBeTruthy();
    expect(pattern.test("hey @BaymiAI")).toBeTruthy();
    expect(pattern.test("@baymiai, thanks")).toBeTruthy();
  });

  it("does not match a longer handle that starts with the bot name", () => {
    const pattern = mentionPattern("baymiai");
    expect(pattern.test("@baymiaibot please help")).toBeFalsy();
    expect(pattern.test("@baymiai-staging please help")).toBeFalsy();
  });

  it("does not match the agent's own name, which is not its GitHub handle", () => {
    expect(mentionPattern("baymiai").test("@baymi please help")).toBeFalsy();
  });
});

describe(isBotLogin, () => {
  it("recognizes the agent and any other App account", () => {
    expect(isBotLogin("baymiai", "baymiai")).toBeTruthy();
    expect(isBotLogin("baymiai[bot]", "baymiai")).toBeTruthy();
    expect(isBotLogin("dependabot[bot]", "baymiai")).toBeTruthy();
    expect(isBotLogin("sam", "baymiai")).toBeFalsy();
  });
});

describe(isIgnoredComment, () => {
  it("ignores eve's own marker comments", () => {
    expect(
      isIgnoredComment(comment({ body: "<!-- eve:github:ack --> working" }))
    ).toBeTruthy();
  });

  it("ignores bot authors and the agent's own login", () => {
    expect(isIgnoredComment(comment({ authorType: "Bot" }))).toBeTruthy();
    expect(
      isIgnoredComment(comment({ authorLogin: "baymiai[bot]" }))
    ).toBeTruthy();
  });

  it("does not ignore a comment with no author", () => {
    expect(isIgnoredComment(comment({ withoutAuthor: true }))).toBeFalsy();
  });
});

describe(shouldDispatchComment, () => {
  it("dispatches a mention from a trusted commenter", () => {
    expect(shouldDispatchComment(comment())).toBeTruthy();
    expect(
      shouldDispatchComment(comment({ association: "COLLABORATOR" }))
    ).toBeTruthy();
  });

  it("acknowledges without dispatching for anyone else", () => {
    expect(shouldDispatchComment(comment({ association: "NONE" }))).toBeFalsy();
    expect(
      shouldDispatchComment(comment({ association: "CONTRIBUTOR" }))
    ).toBeFalsy();
  });

  it("requires a mention", () => {
    expect(
      shouldDispatchComment(comment({ body: "nice change, merging" }))
    ).toBeFalsy();
  });
});
