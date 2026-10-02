import { describe, expect, it, vi } from "vitest";

import type { GitHubSend } from "#lib/remediation/commit";
import { branchName, pushDraftPullRequest } from "#lib/remediation/commit";

const reply = <T>(status: number, body: T) => Promise.resolve({ body, status });

/** A GitHub that answers each Git Data call in order with a fresh sha. */
const github = () =>
  vi.fn<GitHubSend>((path, init) => {
    if (path.includes("/git/commits/") && init.method === "GET") {
      return reply(200, { tree: { sha: "base-tree" } });
    }
    if (path.endsWith("/git/blobs")) {
      return reply(201, { sha: "blob" });
    }
    if (path.endsWith("/git/trees")) {
      return reply(201, { sha: "new-tree" });
    }
    if (path.endsWith("/git/commits")) {
      return reply(201, { sha: "new-commit" });
    }
    if (path.endsWith("/git/refs")) {
      return reply(201, {});
    }
    return reply(201, {
      html_url: "https://github.com/acme/widgets/pull/9",
      number: 9,
    });
  });

const input = (
  send: GitHubSend,
  branch = "baymi/fix-lodash-4.17.21-abc1234"
) => ({
  base: "main",
  baseSha: "abc1234def",
  body: "body",
  branch,
  files: [
    { content: "e30=", mode: "100644" as const, path: "package.json" },
    { content: null, mode: "100644" as const, path: "old.lock" },
  ],
  message: "fix(deps): bump lodash",
  repository: "acme/widgets",
  send,
  title: "fix(deps): bump lodash",
});

describe(branchName, () => {
  it("names the package, the version and the base commit under baymi/", () => {
    expect(
      branchName({
        baseSha: "abc1234def",
        fixedVersion: "7.0.1",
        packageName: "@babel/core",
      })
    ).toBe("baymi/fix-babel-core-7.0.1-abc1234");
  });
});

describe(pushDraftPullRequest, () => {
  it("builds the commit on the base tree and opens a draft", async () => {
    const send = github();
    const pull = await pushDraftPullRequest(input(send));
    expect(pull).toStrictEqual({
      number: 9,
      url: "https://github.com/acme/widgets/pull/9",
    });
    const tree = send.mock.calls.find(([path]) => path.endsWith("/git/trees"));
    expect(tree?.[1].body).toStrictEqual({
      base_tree: "base-tree",
      tree: [
        { mode: "100644", path: "package.json", sha: "blob", type: "blob" },
        { mode: "100644", path: "old.lock", sha: null, type: "blob" },
      ],
    });
    const pullCall = send.mock.calls.at(-1);
    expect(pullCall?.[1].body).toMatchObject({ base: "main", draft: true });
  });

  it("refuses a branch outside baymi/ before calling GitHub", async () => {
    const send = github();
    await expect(pushDraftPullRequest(input(send, "main"))).rejects.toThrow(
      "not a baymi/ branch"
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("stops when the branch already exists", async () => {
    const send = github();
    send.mockImplementation((path, init) =>
      path.endsWith("/git/refs")
        ? reply(422, { message: "Reference already exists" })
        : github()(path, init)
    );
    await expect(pushDraftPullRequest(input(send))).rejects.toThrow(
      "GitHub answered 422 to creating baymi/fix-lodash-4.17.21-abc1234."
    );
  });
});
