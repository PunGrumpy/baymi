import { describe, expect, it, vi } from "vitest";

import type { GitHubSend } from "#lib/chase/commit";
import { deliverFix, groupCommits } from "#lib/chase/deliver";
import type { Delivery } from "#lib/chase/deliver";

const HEAD = "abc1234def5678";

const MESSAGE =
  "fix(math): add both operands\n\nsum returned its first argument.";

const changes = [
  { deleted: false, path: "src/math.ts" },
  { deleted: false, path: "src/math.test.ts" },
];

const regular = (paths: readonly string[]): ReadonlyMap<string, string> =>
  new Map(paths.map((path) => [path, "100644"]));

const MODES = regular(changes.map((change) => change.path));

describe(groupCommits, () => {
  it("splits the change into the commits named", () => {
    expect(
      groupCommits(
        changes,
        [
          { message: MESSAGE, paths: ["src/math.ts"] },
          {
            message:
              "test(math): cover a negative operand\n\nThe fix needed it.",
            paths: ["src/math.test.ts"],
          },
        ],
        MODES
      )
    ).toMatchObject({
      groups: [
        { changes: [changes[0]], message: MESSAGE },
        { changes: [changes[1]] },
      ],
      ok: true,
    });
  });

  it("lists every way the commits do not cover the change exactly once", () => {
    const grouping = groupCommits(
      changes,
      [
        { message: "Fix it", paths: ["src/math.ts", "README.md"] },
        { message: MESSAGE, paths: ["src/math.ts"] },
      ],
      MODES
    );
    expect(grouping.ok).toBeFalsy();
    expect(!grouping.ok && grouping.problems).toStrictEqual([
      expect.stringMatching(/^Commit 1: The subject is not a Conventional/u),
      "Commit 1: There is no body after a blank line saying what failed and what changed.",
      "Commit 1 names README.md, which did not change.",
      "src/math.ts is in commit 1 and commit 2.",
      "src/math.test.ts changed but is in no commit.",
    ]);
  });

  it("refuses an empty change, a path that may not be pushed, and no commits", () => {
    expect(groupCommits([], [], MODES)).toStrictEqual({
      ok: false,
      problems: [
        "Nothing changed in the repository.",
        "Name at least one commit.",
      ],
    });
    const grouping = groupCommits(
      [{ deleted: false, path: "node_modules/x/index.js" }],
      [{ message: MESSAGE, paths: ["node_modules/x/index.js"] }],
      regular(["node_modules/x/index.js"])
    );
    expect(!grouping.ok && grouping.problems).toStrictEqual([
      "node_modules/x/index.js may not be pushed.",
    ]);
  });

  it("refuses a symlink in the change set", () => {
    const linked = [...changes, { deleted: false, path: "docs/leak-file" }];
    const grouping = groupCommits(
      linked,
      [{ message: MESSAGE, paths: linked.map((change) => change.path) }],
      new Map([...MODES, ["docs/leak-file", "120000"]])
    );
    expect(grouping.ok).toBeFalsy();
    expect(!grouping.ok && grouping.problems).toStrictEqual([
      "docs/leak-file is a symlink (mode 120000); a chase pushes regular files only.",
    ]);
  });

  it("refuses any change under .github/workflows, a deletion included", () => {
    const touched = [
      ...changes,
      { deleted: false, path: ".github/workflows/ci.yml" },
      { deleted: true, path: ".github/workflows/old.yml" },
    ];
    const grouping = groupCommits(
      touched,
      [{ message: MESSAGE, paths: touched.map((change) => change.path) }],
      regular(touched.map((change) => change.path))
    );
    expect(grouping.ok).toBeFalsy();
    expect(!grouping.ok && grouping.problems).toStrictEqual([
      ".github/workflows/ci.yml is under .github/workflows, which a chase never changes.",
      ".github/workflows/old.yml is under .github/workflows, which a chase never changes.",
    ]);
  });
});

interface Repo {
  readonly headProtected?: boolean;
  readonly headRepository?: string;
  /** The heads `GET /pulls/42` answers, in order; the last repeats. */
  readonly heads?: readonly string[];
  readonly pushStatus?: number;
}

/** What a `GitHubSend` answers with, as the code under test reads it. */
type GitHubBody = Awaited<ReturnType<GitHubSend>>["body"];

const reply = (status: number, body: GitHubBody) =>
  Promise.resolve({ body, status });

/** A GitHub for one same-repository pull request, PunGrumpy/baymi#42 on feat/sum. */
const github = (repo: Repo = {}) => {
  const heads = [...(repo.heads ?? [HEAD])];
  let commits = 0;
  return vi.fn<GitHubSend>((path, init) => {
    if (path.endsWith("/pulls/42")) {
      const sha = heads.length > 1 ? heads.shift() : heads[0];
      return reply(200, {
        head: {
          ref: "feat/sum",
          repo: { full_name: repo.headRepository ?? "PunGrumpy/baymi" },
          sha,
        },
      });
    }
    if (path === "/repos/PunGrumpy/baymi") {
      return reply(200, {
        default_branch: "main",
        full_name: "PunGrumpy/baymi",
        // What an installation token is told, measured: not what it may do.
        permissions: { pull: false, push: false },
      });
    }
    if (path.includes("/branches/")) {
      return reply(200, { protected: repo.headProtected ?? false });
    }
    if (path.includes("/git/commits/") && init.method === "GET") {
      return reply(200, { tree: { sha: "head-tree" } });
    }
    if (path.endsWith("/git/commits")) {
      commits += 1;
      return reply(201, { sha: `fix-${commits}` });
    }
    if (path.includes("/git/refs/heads/")) {
      return reply(repo.pushStatus ?? 200, {});
    }
    if (path.endsWith("/git/refs")) {
      return reply(201, {});
    }
    if (path.endsWith("/pulls")) {
      return reply(201, {
        html_url: "https://github.com/PunGrumpy/baymi/pull/43",
        number: 43,
      });
    }
    return reply(201, { sha: "blob-or-tree" });
  });
};

const delivery = (send: GitHubSend): Delivery => ({
  checks: [{ exitCode: 0, name: "test", passed: true }],
  commits: [
    {
      files: [{ content: "YQ==", mode: "100644", path: "src/math.ts" }],
      message: MESSAGE,
    },
  ],
  pullRequestBody: "body",
  send,
  task: {
    headRef: "feat/sum",
    headSha: HEAD,
    pullRequest: 42,
    repository: "PunGrumpy/baymi",
    url: "https://github.com/PunGrumpy/baymi/pull/42",
  },
});

const calls = (send: ReturnType<typeof github>, method: string) =>
  send.mock.calls
    .filter(([, init]) => init.method === method)
    .map(([path]) => path);

describe(deliverFix, () => {
  it("fast-forwards the head branch of a same-repository pull request", async () => {
    const send = github();
    const result = await deliverFix(delivery(send));
    expect(result).toMatchObject({
      branch: "feat/sum",
      commits: ["fix-1"],
      fixPullRequest: null,
      notVerified: [],
      status: "pushed",
    });
    expect(calls(send, "PATCH")).toStrictEqual([
      "/repos/PunGrumpy/baymi/git/refs/heads/feat/sum",
    ]);
    expect(calls(send, "POST")).not.toContain("/repos/PunGrumpy/baymi/pulls");
  });

  it("opens a pull request against a protected head branch, and never pushes to it", async () => {
    const send = github({ headProtected: true });
    const result = await deliverFix(delivery(send));
    expect(result).toMatchObject({
      branch: "baymi/chase/42-abc1234",
      fixPullRequest: "https://github.com/PunGrumpy/baymi/pull/43",
      status: "opened-pull-request",
    });
    expect(calls(send, "PATCH")).toStrictEqual([]);
  });

  it("falls back to a pull request when GitHub refuses the fast-forward", async () => {
    const send = github({ pushStatus: 422 });
    const result = await deliverFix(delivery(send));
    expect(result.status).toBe("opened-pull-request");
  });

  it("reports a repository the App cannot write when GitHub refuses the push with 403", async () => {
    const send = github({ pushStatus: 403 });
    const result = await deliverFix(delivery(send));
    expect(result).toMatchObject({
      reason:
        "GitHub refused the App's push with 403: it cannot write to this repository.",
      status: "failed",
    });
    expect(calls(send, "POST")).not.toContain("/repos/PunGrumpy/baymi/pulls");
  });

  it("pushes nothing to a fork's branch", async () => {
    const send = github({ headRepository: "stranger/baymi" });
    const result = await deliverFix(delivery(send));
    expect(result).toMatchObject({ commits: [], status: "failed" });
    expect(calls(send, "POST")).toStrictEqual([]);
    expect(calls(send, "PATCH")).toStrictEqual([]);
  });

  it("stops without pushing when the head moved, before or during the push", async () => {
    const before = github({ heads: ["someone-else"] });
    await expect(deliverFix(delivery(before))).resolves.toMatchObject({
      status: "superseded",
    });
    expect(calls(before, "POST")).toStrictEqual([]);
    const during = github({
      heads: [HEAD, HEAD, "someone-else"],
      pushStatus: 422,
    });
    await expect(deliverFix(delivery(during))).resolves.toMatchObject({
      status: "superseded",
    });
    expect(calls(during, "POST")).not.toContain("/repos/PunGrumpy/baymi/pulls");
  });
});
