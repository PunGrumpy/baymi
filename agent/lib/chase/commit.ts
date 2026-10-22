import { z } from "zod";

import { CHASE_BRANCH_PREFIX } from "#lib/chase/branch";

/**
 * Pushes a chase's fix through the GitHub API rather than git: commits on
 * top of the pull request's head, then a fast-forward of its branch, or a
 * new `baymi/chase/` branch and a pull request against it.
 *
 * @remarks
 * The installation token can write. It stays in the app runtime, where this
 * runs, and never enters the sandbox that installed packages and ran the
 * project's tests. The Git Data API builds each commit from file contents
 * the runtime read out of the sandbox: one blob per changed file, a tree on
 * top of the previous commit's tree, a commit with the previous one as its
 * parent. Moving a branch is `PATCH /git/refs` with `force: false`, which
 * GitHub refuses unless the new commit descends from the branch's current
 * one, so a push here can never rewrite history. There is no call here that
 * merges, rebases, closes, or deletes anything.
 */

const GITHUB_API = "https://api.github.com";

/** The one call this needs, with a body and a method, narrowed for tests. */
export type GitHubSend = (
  path: string,
  init: { readonly body?: object; readonly method: "GET" | "PATCH" | "POST" }
) => Promise<{ readonly body: unknown; readonly status: number }>;

/** Wraps `fetch` with the installation token as a `GitHubSend`. */
export const githubSend =
  (token: string, fetchImpl: typeof fetch = fetch): GitHubSend =>
  async (path, init) => {
    const response = await fetchImpl(`${GITHUB_API}${path}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      method: init.method,
    });
    const text = await response.text();
    return { body: text ? JSON.parse(text) : null, status: response.status };
  };

/** One file in a commit: its bytes and mode, or a deletion. */
export interface CommitFile {
  /** Base64 of the file's bytes, or null to delete the path. */
  readonly content: string | null;
  /** `100644` for a regular file, `100755` for an executable one. */
  readonly mode: "100644" | "100755";
  readonly path: string;
}

/** One commit to create: its message and the files it changes. */
export interface CommitPlan {
  readonly files: readonly CommitFile[];
  readonly message: string;
}

const SHA = z.object({ sha: z.string() });
const COMMIT = z.object({ tree: z.object({ sha: z.string() }) });
const PULL = z.object({ html_url: z.string(), number: z.number().int() });

const expectParsed = <T>(
  step: string,
  response: { readonly body: unknown; readonly status: number },
  status: number,
  schema: z.ZodType<T>
): T => {
  if (response.status !== status) {
    throw new Error(`GitHub answered ${response.status} to ${step}.`);
  }
  return schema.parse(response.body);
};

/**
 * Creates `commits` in order on top of `parentSha`, each the parent of the
 * next, and answers their shas. No branch moves; the commits are unreachable
 * until a ref points at the last one.
 */
export const createCommits = async (input: {
  readonly commits: readonly CommitPlan[];
  readonly parentSha: string;
  readonly repository: string;
  readonly send: GitHubSend;
}): Promise<readonly string[]> => {
  const { repository, send } = input;
  if (input.commits.length === 0) {
    throw new Error("There is no change to push.");
  }
  const repo = `/repos/${repository}`;
  let parent = input.parentSha;
  let { sha: parentTree } = expectParsed(
    "reading the head commit",
    await send(`${repo}/git/commits/${parent}`, { method: "GET" }),
    200,
    COMMIT
  ).tree;
  const shas: string[] = [];
  for (const commit of input.commits) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each commit is the next one's parent
    const tree = await Promise.all(
      commit.files.map(async (file) => {
        if (file.content === null) {
          return { mode: file.mode, path: file.path, sha: null, type: "blob" };
        }
        const blob = expectParsed(
          `creating a blob for ${file.path}`,
          await send(`${repo}/git/blobs`, {
            body: { content: file.content, encoding: "base64" },
            method: "POST",
          }),
          201,
          SHA
        );
        return {
          mode: file.mode,
          path: file.path,
          sha: blob.sha,
          type: "blob",
        };
      })
    );
    const newTree = expectParsed(
      "creating the tree",
      // oxlint-disable-next-line eslint/no-await-in-loop -- each commit is the next one's parent
      await send(`${repo}/git/trees`, {
        body: { base_tree: parentTree, tree },
        method: "POST",
      }),
      201,
      SHA
    );
    const created = expectParsed(
      "creating the commit",
      // oxlint-disable-next-line eslint/no-await-in-loop -- each commit is the next one's parent
      await send(`${repo}/git/commits`, {
        body: { message: commit.message, parents: [parent], tree: newTree.sha },
        method: "POST",
      }),
      201,
      SHA
    );
    shas.push(created.sha);
    parent = created.sha;
    parentTree = newTree.sha;
  }
  return shas;
};

export type FastForward =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number };

/**
 * Moves `branch` to `sha`, only as a fast-forward.
 *
 * @remarks
 * `force: false` is GitHub's own guard: it answers 422 when `sha` does not
 * descend from the branch's head, which is also what a branch that moved
 * since the chase read it looks like. A protected branch answers 422 or 403.
 * The caller decides what a refusal means, so this reports the status
 * instead of throwing.
 */
export const fastForward = async (input: {
  readonly branch: string;
  readonly repository: string;
  readonly send: GitHubSend;
  readonly sha: string;
}): Promise<FastForward> => {
  const response = await input.send(
    `/repos/${input.repository}/git/refs/heads/${input.branch}`,
    { body: { force: false, sha: input.sha }, method: "PATCH" }
  );
  return response.status === 200
    ? { ok: true }
    : { ok: false, status: response.status };
};

/**
 * Creates a `baymi/chase/` branch at `sha` and opens a pull request from it
 * into `base`, the head branch the fix is for.
 *
 * @remarks
 * Refuses a branch outside `baymi/chase/` before any call. A ref that already
 * exists answers 422 and stops the push, so two chases never share a branch.
 */
export const openFixPullRequest = async (input: {
  readonly base: string;
  readonly body: string;
  readonly branch: string;
  readonly repository: string;
  readonly send: GitHubSend;
  readonly sha: string;
  readonly title: string;
}): Promise<{ readonly number: number; readonly url: string }> => {
  const { branch, repository, send } = input;
  if (!branch.startsWith(CHASE_BRANCH_PREFIX) || branch.includes("..")) {
    throw new Error(
      `Refusing to create ${branch}: not a ${CHASE_BRANCH_PREFIX} branch.`
    );
  }
  const repo = `/repos/${repository}`;
  expectParsed(
    `creating ${branch}`,
    await send(`${repo}/git/refs`, {
      body: { ref: `refs/heads/${branch}`, sha: input.sha },
      method: "POST",
    }),
    201,
    z.unknown()
  );
  const pull = expectParsed(
    "opening the pull request",
    await send(`${repo}/pulls`, {
      body: {
        base: input.base,
        body: input.body,
        head: branch,
        title: input.title,
      },
      method: "POST",
    }),
    201,
    PULL
  );
  return { number: pull.number, url: pull.html_url };
};
