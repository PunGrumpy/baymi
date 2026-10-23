import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { readPullRequest, skipPullRequest } from "#lib/github/ci/pull-request";
import type { PullRequestFacts } from "#lib/github/ci/pull-request";

const HEAD = "3c41196471a0ba382508ce887681b1403f1a47cd";

const pullRequest = (
  overrides: Partial<PullRequestFacts> = {}
): PullRequestFacts => ({
  draft: false,
  head: { sha: HEAD },
  state: "open",
  title: "feat: a thing",
  user: { login: "PunGrumpy", type: "User" },
  ...overrides,
});

describe(skipPullRequest, () => {
  it("chases an open, ready pull request by the owner on the commit that failed", () => {
    expect(
      skipPullRequest(pullRequest(), { headSha: HEAD }, "PunGrumpy")
    ).toBeNull();
  });

  it("compares logins without regard to case", () => {
    expect(
      skipPullRequest(pullRequest(), { headSha: HEAD }, "pungrumpy")
    ).toBeNull();
  });

  it("chases a bot's pull request on the owner's repository", () => {
    const bot = pullRequest({
      user: { login: "github-actions[bot]", type: "Bot" },
    });
    expect(skipPullRequest(bot, { headSha: HEAD }, "PunGrumpy")).toBeNull();
  });

  it("skips a closed or merged pull request", () => {
    expect(
      skipPullRequest(
        pullRequest({ state: "closed" }),
        { headSha: HEAD },
        "PunGrumpy"
      )
    ).toBe("closed");
  });

  it("skips a draft", () => {
    expect(
      skipPullRequest(
        pullRequest({ draft: true }),
        { headSha: HEAD },
        "PunGrumpy"
      )
    ).toBe("draft");
  });

  it("skips an event older than the pull request's head", () => {
    expect(
      skipPullRequest(pullRequest(), { headSha: "f".repeat(40) }, "PunGrumpy")
    ).toBe("head-moved");
  });

  it("skips someone else's pull request", () => {
    const stranger = pullRequest({ user: { login: "eve", type: "User" } });
    expect(skipPullRequest(stranger, { headSha: HEAD }, "PunGrumpy")).toBe(
      "not-the-maintainers"
    );
  });
});

describe(readPullRequest, () => {
  it("reads the pull request from the repository and number it is given", async () => {
    const seen: string[] = [];
    const facts = await readPullRequest(
      (input) => {
        seen.push(input.path);
        return Promise.resolve({
          body: {
            draft: false,
            head: { sha: HEAD },
            number: 7,
            state: "open",
            title: "x",
            user: { login: "PunGrumpy", type: "User" },
          },
        });
      },
      { owner: "PunGrumpy", pullRequest: 7, repo: "baymi" }
    );
    expect(seen).toStrictEqual(["/repos/PunGrumpy/baymi/pulls/7"]);
    expect(facts.head.sha).toBe(HEAD);
  });

  it("throws on a body that is not a pull request", async () => {
    await expect(
      readPullRequest(() => Promise.resolve({ body: "nope" }), {
        owner: "o",
        pullRequest: 1,
        repo: "r",
      })
    ).rejects.toBeInstanceOf(ZodError);
  });
});
