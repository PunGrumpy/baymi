import { describe, expect, it, vi } from "vitest";

import {
  createCommits,
  fastForward,
  openFixPullRequest,
} from "#lib/chase/commit";
import type { GitHubSend } from "#lib/chase/commit";

const reply = <T>(status: number, body: T) => Promise.resolve({ body, status });

/** A GitHub that answers each Git Data call with a fresh, numbered sha. */
const github = () => {
  let count = 0;
  const next = (kind: string) => {
    count += 1;
    return `${kind}-${count}`;
  };
  return vi.fn<GitHubSend>((path, init) => {
    if (path.includes("/git/commits/") && init.method === "GET") {
      return reply(200, { tree: { sha: "head-tree" } });
    }
    if (path.endsWith("/git/blobs")) {
      return reply(201, { sha: next("blob") });
    }
    if (path.endsWith("/git/trees")) {
      return reply(201, { sha: next("tree") });
    }
    if (path.endsWith("/git/commits")) {
      return reply(201, { sha: next("commit") });
    }
    if (path.endsWith("/git/refs")) {
      return reply(201, {});
    }
    if (path.includes("/git/refs/heads/")) {
      return reply(200, {});
    }
    return reply(201, {
      html_url: "https://github.com/acme/widgets/pull/43",
      number: 43,
    });
  });
};

const bodyOf = (send: ReturnType<typeof github>, suffix: string) =>
  send.mock.calls
    .filter(([path]) => path.endsWith(suffix))
    .map(([, init]) => init.body);

describe(createCommits, () => {
  it("chains each commit on the previous one, starting from the head", async () => {
    const send = github();
    const shas = await createCommits({
      commits: [
        {
          files: [{ content: "YQ==", mode: "100644", path: "src/math.ts" }],
          message: "fix(math): add both operands\n\nbody",
        },
        {
          files: [{ content: null, mode: "100644", path: "src/old.ts" }],
          message: "refactor: drop the unused helper\n\nbody",
        },
      ],
      parentSha: "head",
      repository: "acme/widgets",
      send,
    });
    expect(shas).toStrictEqual(["commit-3", "commit-5"]);
    expect(bodyOf(send, "/git/trees")).toStrictEqual([
      {
        base_tree: "head-tree",
        tree: [
          {
            mode: "100644",
            path: "src/math.ts",
            sha: "blob-1",
            type: "blob",
          },
        ],
      },
      {
        base_tree: "tree-2",
        tree: [{ mode: "100644", path: "src/old.ts", sha: null, type: "blob" }],
      },
    ]);
    expect(bodyOf(send, "/git/commits")).toMatchObject([
      { parents: ["head"] },
      { parents: ["commit-3"] },
    ]);
  });

  it("refuses an empty change before calling GitHub", async () => {
    const send = github();
    await expect(
      createCommits({ commits: [], parentSha: "h", repository: "a/b", send })
    ).rejects.toThrow("There is no change to push.");
    expect(send).not.toHaveBeenCalled();
  });
});

describe(fastForward, () => {
  it("moves the branch without force and reports a refusal", async () => {
    const send = github();
    await expect(
      fastForward({
        branch: "feat/thing",
        repository: "acme/widgets",
        send,
        sha: "commit-5",
      })
    ).resolves.toStrictEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      "/repos/acme/widgets/git/refs/heads/feat/thing",
      { body: { force: false, sha: "commit-5" }, method: "PATCH" }
    );
    send.mockReturnValue(
      reply(422, { message: "Update is not a fast forward" })
    );
    await expect(
      fastForward({
        branch: "feat/thing",
        repository: "acme/widgets",
        send,
        sha: "commit-5",
      })
    ).resolves.toStrictEqual({ ok: false, status: 422 });
  });
});

describe("fastForward's ref URL", () => {
  const targets = (branch: string) => {
    const send = github();
    return fastForward({
      branch,
      repository: "acme/widgets",
      send,
      sha: "commit-5",
    }).then(() => {
      const [path] = send.mock.calls[0] ?? [""];
      return new URL(path, "https://api.github.com");
    });
  };

  it("targets the head named main#x, not main", async () => {
    const url = await targets("main#x");
    expect(url.pathname).toBe("/repos/acme/widgets/git/refs/heads/main%23x");
    expect(url.hash).toBe("");
    expect(url.search).toBe("");
  });

  it("keeps the slashes of a branch and encodes what else a name may hold", async () => {
    const url = await targets("release/a%2Fb c?d");
    expect(url.pathname).toBe(
      "/repos/acme/widgets/git/refs/heads/release/a%252Fb%20c%3Fd"
    );
    expect(url.search).toBe("");
    const deep = await targets("feat/deep/thing");
    expect(deep.pathname).toBe(
      "/repos/acme/widgets/git/refs/heads/feat/deep/thing"
    );
  });
});

const fixInput = (send: GitHubSend, branch = "baymi/chase/42-abc1234") => ({
  base: "feat/thing",
  body: "body",
  branch,
  repository: "acme/widgets",
  send,
  sha: "commit-5",
  title: "fix(math): add both operands",
});

describe(openFixPullRequest, () => {
  it("opens a pull request from a baymi/chase/ branch into the head branch", async () => {
    const send = github();
    await expect(openFixPullRequest(fixInput(send))).resolves.toStrictEqual({
      number: 43,
      url: "https://github.com/acme/widgets/pull/43",
    });
    expect(bodyOf(send, "/git/refs")).toStrictEqual([
      { ref: "refs/heads/baymi/chase/42-abc1234", sha: "commit-5" },
    ]);
    expect(bodyOf(send, "/pulls")).toStrictEqual([
      {
        base: "feat/thing",
        body: "body",
        head: "baymi/chase/42-abc1234",
        title: "fix(math): add both operands",
      },
    ]);
  });

  it("refuses a branch outside baymi/chase/ before calling GitHub", async () => {
    const send = github();
    await expect(
      openFixPullRequest(fixInput(send, "feat/thing"))
    ).rejects.toThrow("not a baymi/chase/ branch");
    await expect(
      openFixPullRequest(fixInput(send, "baymi/chase/../main"))
    ).rejects.toThrow("not a baymi/chase/ branch");
    expect(send).not.toHaveBeenCalled();
  });

  it("stops when the branch already exists", async () => {
    const send = github();
    send.mockImplementation((path, init) =>
      path.endsWith("/git/refs")
        ? reply(422, { message: "Reference already exists" })
        : github()(path, init)
    );
    await expect(openFixPullRequest(fixInput(send))).rejects.toThrow(
      "GitHub answered 422 to creating baymi/chase/42-abc1234."
    );
  });
});
