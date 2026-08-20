import { describe, expect, it } from "vitest";

import { digestPrompt, digestRepos } from "#lib/digest";

describe("DIGEST_REPOS", () => {
  it("reads a single repository", () => {
    expect(digestRepos.parse("acme/widgets")).toStrictEqual(["acme/widgets"]);
  });

  it("reads a comma-separated list and ignores the spacing", () => {
    expect(
      digestRepos.parse("acme/widgets, acme/docs ,acme/cli")
    ).toStrictEqual(["acme/widgets", "acme/docs", "acme/cli"]);
  });

  it("drops duplicates so one repo never posts twice", () => {
    expect(digestRepos.parse("acme/widgets,acme/widgets")).toStrictEqual([
      "acme/widgets",
    ]);
  });

  it("tolerates a trailing comma", () => {
    expect(digestRepos.parse("acme/widgets,")).toStrictEqual(["acme/widgets"]);
  });

  it("rejects an entry that is not owner/repo", () => {
    expect(() => digestRepos.parse("acme/widgets,not-a-repo")).toThrow(
      /owner\/repo/u
    );
  });

  it("rejects an empty list", () => {
    expect(() => digestRepos.parse(" , ")).toThrow(/at least one/u);
  });
});

describe(digestPrompt, () => {
  it("names the repository it was given and no other", () => {
    const prompt = digestPrompt("acme/widgets");
    expect(prompt).toContain("acme/widgets");
    expect(prompt).toContain("Weekly issues digest: acme/widgets");
  });

  it("tells the session to load the digest-format skill", () => {
    expect(digestPrompt("acme/widgets")).toContain("digest-format");
  });
});
