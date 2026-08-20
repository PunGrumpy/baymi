import type { GitHubComment } from "eve/channels/github";
import { describe, expect, it } from "vitest";

import {
  BOT_NAME,
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
    body = `@${BOT_NAME} what is the status of #12?`,
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
    expect(pattern.test("@baymiai_2 please help")).toBeFalsy();
  });

  it("does not match the agent's own name, which is not its GitHub handle", () => {
    const pattern = mentionPattern("baymiai");
    expect(pattern.test("@baymi can you look at this?")).toBeFalsy();
  });

  it("escapes regex metacharacters in the bot name", () => {
    const pattern = mentionPattern("bay.mi");
    expect(pattern.test("@bay.mi hello")).toBeTruthy();
    expect(pattern.test("@bayXmi hello")).toBeFalsy();
  });
});

describe(isIgnoredComment, () => {
  it("ignores eve's own marker comments", () => {
    expect(
      isIgnoredComment(comment({ body: "<!-- eve:github:1 -->" }))
    ).toBeTruthy();
  });

  it("ignores every bot author", () => {
    expect(
      isIgnoredComment(
        comment({ authorLogin: "dependabot", authorType: "Bot" })
      )
    ).toBeTruthy();
  });

  it("ignores the agent's own login even when GitHub types it as a user", () => {
    expect(
      isIgnoredComment(comment({ authorLogin: "BaymiAI[bot]" }))
    ).toBeTruthy();
  });

  it("keeps a human comment", () => {
    expect(isIgnoredComment(comment())).toBeFalsy();
  });

  it("keeps a comment whose author GitHub omitted", () => {
    expect(isIgnoredComment(comment({ withoutAuthor: true }))).toBeFalsy();
  });
});

describe(shouldDispatchComment, () => {
  it("dispatches a mention from someone trusted with the repo", () => {
    expect(shouldDispatchComment(comment())).toBeTruthy();
  });

  it("does not dispatch a mention from an untrusted commenter", () => {
    expect(shouldDispatchComment(comment({ association: "NONE" }))).toBeFalsy();
  });

  it("does not dispatch a comment that never mentions the agent", () => {
    expect(
      shouldDispatchComment(comment({ body: "looks good to me" }))
    ).toBeFalsy();
  });

  it("does not dispatch the agent's own comments, however trusted", () => {
    expect(
      shouldDispatchComment(
        comment({ authorLogin: "baymiai[bot]", authorType: "Bot" })
      )
    ).toBeFalsy();
  });
});
