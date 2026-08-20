import { describe, expect, it } from "vitest";

import {
  pushBrokerPolicy,
  pushUrl,
  resolveInstallationToken,
  validatePushBranch,
  validatePushRepo,
} from "#lib/github/push";

const REPOS = ["acme/widgets", "acme/docs"];

describe(validatePushBranch, () => {
  it("accepts an ordinary branch name", () => {
    expect(validatePushBranch("fix/digest-empty-state")).toBeNull();
    expect(validatePushBranch("chore.bump-1")).toBeNull();
  });

  it("refuses the protected branches outright", () => {
    expect(validatePushBranch("main")).toContain("not allowed");
    expect(validatePushBranch("master")).toContain("not allowed");
  });

  it("refuses the ways a ref reaches a protected branch under another name", () => {
    expect(validatePushBranch("refs/heads/main")).toContain(
      "plain branch name"
    );
    expect(validatePushBranch("HEAD")).toContain("plain branch name");
  });

  it("refuses anything that could carry meaning into a shell", () => {
    for (const branch of [
      "fix; rm -rf /",
      "fix$(whoami)",
      "fix`id`",
      "fix|tee",
      "fix branch",
      "fix&&echo",
    ]) {
      expect(validatePushBranch(branch)).toContain("not a valid branch name");
    }
  });

  it("refuses path traversal and empty segments", () => {
    expect(validatePushBranch("fix/../main")).toContain("not a valid branch");
    expect(validatePushBranch("fix//main")).toContain("not a valid branch");
  });

  it("refuses a name that does not start or end alphanumeric", () => {
    expect(validatePushBranch("-fix")).toContain("not a valid branch name");
    expect(validatePushBranch("fix-")).toContain("not a valid branch name");
    expect(validatePushBranch("")).toContain("not a valid branch name");
  });
});

describe(validatePushRepo, () => {
  it("accepts a followed repository, case insensitively", () => {
    expect(validatePushRepo("acme/widgets", REPOS)).toBeNull();
    expect(validatePushRepo("ACME/Widgets", REPOS)).toBeNull();
  });

  it("refuses a repository the agent does not follow", () => {
    expect(validatePushRepo("acme/secret", REPOS)).toContain(
      "not one of the repositories"
    );
  });

  it("refuses anything that is not owner/repo", () => {
    expect(validatePushRepo("widgets", REPOS)).toContain("not an owner/repo");
    expect(validatePushRepo("acme/widgets; rm -rf /", REPOS)).toContain(
      "not an owner/repo"
    );
  });
});

describe(pushBrokerPolicy, () => {
  it("attaches the token to github.com and leaves other egress alone", () => {
    const { allow } = pushBrokerPolicy("ghs_example");
    expect(allow["github.com"][0].transform[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("x-access-token:ghs_example").toString("base64")}`
    );
    expect(allow["*"]).toStrictEqual([]);
  });

  it("never puts the raw token in the policy", () => {
    // It is base64 of `x-access-token:<token>`, so the bare token must not
    // appear anywhere a log or an error might echo.
    expect(JSON.stringify(pushBrokerPolicy("ghs_secret"))).not.toContain(
      "ghs_secret"
    );
  });
});

describe(pushUrl, () => {
  it("builds the remote from the repository, not from git config", () => {
    expect(pushUrl("acme/widgets")).toBe("https://github.com/acme/widgets.git");
  });
});

describe(resolveInstallationToken, () => {
  it("passes a pre-resolved token straight through", async () => {
    await expect(resolveInstallationToken("ghs_example")).resolves.toBe(
      "ghs_example"
    );
  });

  it("calls the deferred form, which is what Connect supplies", async () => {
    await expect(
      resolveInstallationToken(() => Promise.resolve("ghs_minted"))
    ).resolves.toBe("ghs_minted");
    await expect(resolveInstallationToken(() => "ghs_sync")).resolves.toBe(
      "ghs_sync"
    );
  });
});
