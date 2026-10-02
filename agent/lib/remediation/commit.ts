import { z } from "zod";

/**
 * Pushes a remediation as a commit on a `baymi/` branch and opens a draft
 * pull request, through the GitHub API rather than git.
 *
 * @remarks
 * The installation token can write. It stays in the app runtime, where this
 * runs, and never enters the sandbox that installed packages and ran the
 * project's tests. The Git Data API builds the commit from file contents
 * the runtime read out of the sandbox: one blob per changed file, a tree on
 * top of the base commit's tree, a commit with the base as its parent, and a
 * new ref. A branch protection rule on the default branch is what stops a
 * push there; this module never names a ref outside `baymi/`.
 */

const GITHUB_API = "https://api.github.com";

/** Every branch this module creates starts with this. */
export const BRANCH_PREFIX = "baymi/";

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

/** One file in the commit: its bytes and mode, or a deletion. */
export interface CommitFile {
  /** Base64 of the file's bytes, or null to delete the path. */
  readonly content: string | null;
  /** `100644` for a regular file, `100755` for an executable one. */
  readonly mode: "100644" | "100755";
  readonly path: string;
}

/**
 * The branch for one fix: the package, the version and the base commit, so
 * a second run on the same commit fails rather than overwriting the first.
 */
export const branchName = (input: {
  readonly baseSha: string;
  readonly fixedVersion: string;
  readonly packageName: string;
}): string => {
  const slug = `${input.packageName}-${input.fixedVersion}`
    .replaceAll(/[^\w.-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return `${BRANCH_PREFIX}fix-${slug}-${input.baseSha.slice(0, 7)}`;
};

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
 * Commits `files` on top of `baseSha`, creates `branch` at the commit, and
 * opens a draft pull request from it into `base`.
 *
 * @remarks
 * Refuses a branch outside `baymi/` before any call. A ref that already
 * exists answers 422 and stops the push, so two runs never share a branch.
 */
export const pushDraftPullRequest = async (input: {
  readonly base: string;
  readonly baseSha: string;
  readonly body: string;
  readonly branch: string;
  readonly files: readonly CommitFile[];
  readonly message: string;
  readonly repository: string;
  readonly send: GitHubSend;
  readonly title: string;
}): Promise<{ readonly number: number; readonly url: string }> => {
  const { branch, repository, send } = input;
  if (!branch.startsWith(BRANCH_PREFIX) || branch.includes("..")) {
    throw new Error(
      `Refusing to push to ${branch}: not a ${BRANCH_PREFIX} branch.`
    );
  }
  if (input.files.length === 0) {
    throw new Error("There is no change to push.");
  }
  const repo = `/repos/${repository}`;
  const base = expectParsed(
    "reading the base commit",
    await send(`${repo}/git/commits/${input.baseSha}`, { method: "GET" }),
    200,
    COMMIT
  );
  const tree = await Promise.all(
    input.files.map(async (file) => {
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
      return { mode: file.mode, path: file.path, sha: blob.sha, type: "blob" };
    })
  );
  const newTree = expectParsed(
    "creating the tree",
    await send(`${repo}/git/trees`, {
      body: { base_tree: base.tree.sha, tree },
      method: "POST",
    }),
    201,
    SHA
  );
  const commit = expectParsed(
    "creating the commit",
    await send(`${repo}/git/commits`, {
      body: {
        message: input.message,
        parents: [input.baseSha],
        tree: newTree.sha,
      },
      method: "POST",
    }),
    201,
    SHA
  );
  expectParsed(
    `creating ${branch}`,
    await send(`${repo}/git/refs`, {
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
      method: "POST",
    }),
    201,
    z.unknown()
  );
  const pull = expectParsed(
    "opening the draft pull request",
    await send(`${repo}/pulls`, {
      body: {
        base: input.base,
        body: input.body,
        draft: true,
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
