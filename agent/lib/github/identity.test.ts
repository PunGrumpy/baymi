import type { GitHubComment } from "eve/channels/github";
import { describe, expect, it } from "vitest";

import { isIgnoredComment } from "#lib/github/comments";
import {
  BOT_EMAIL,
  BOT_LOGIN,
  GIT_IDENTITY_COMMAND,
  noreplyEmail,
} from "#lib/github/identity";

/** A comment the agent itself left, as the channel would hand it over. */
const ownComment = (): GitHubComment => ({
  author: {
    htmlUrl: undefined,
    id: 1,
    login: BOT_LOGIN,
    type: "User",
    url: undefined,
  },
  body: "I opened #14 with the fix.",
  htmlUrl: undefined,
  id: 1,
  raw: { author_association: "NONE" },
  url: undefined,
});

describe(noreplyEmail, () => {
  it("composes the address GitHub resolves to an account", () => {
    expect(noreplyEmail(1234, "octocat")).toBe(
      "1234+octocat@users.noreply.github.com"
    );
  });
});

describe("the agent's own identity", () => {
  it("commits as the App's bot account", () => {
    expect(BOT_LOGIN).toBe("baymiai[bot]");
  });

  it("carries the account id, without which the commit links to nobody", () => {
    expect(BOT_EMAIL).toMatch(
      /^\d+\+baymiai\[bot\]@users\.noreply\.github\.com$/u
    );
  });

  it("is the login the comment gate already refuses to answer", () => {
    // The author type is `User` so the login is what decides this, not the
    // blanket bot rule: these two names have to stay the same string.
    expect(isIgnoredComment(ownComment())).toBeTruthy();
  });
});

describe(GIT_IDENTITY_COMMAND, () => {
  it("sets both halves globally, so a fresh clone inherits them", () => {
    expect(GIT_IDENTITY_COMMAND).toBe(
      `git config --global user.name '${BOT_LOGIN}' && git config --global user.email '${BOT_EMAIL}'`
    );
  });
});
