import { z } from "zod";

import {
  fallBackToPullRequest,
  planPush,
  REFUSAL_REASONS,
} from "#lib/chase/branch";
import type { BranchFacts, PushPlan } from "#lib/chase/branch";
import type { ChangedPath } from "#lib/chase/checks";
import {
  createCommits,
  fastForward,
  openFixPullRequest,
} from "#lib/chase/commit";
import type { CommitPlan, GitHubSend } from "#lib/chase/commit";
import { commitMessageProblems } from "#lib/chase/message";
import type { ChaseCheck, ChaseResult } from "#lib/chase/result";
import type { ChaseCheckout } from "#lib/chase/state";
import {
  MAX_CHANGED_FILES,
  modeProblems,
  pathProblem,
} from "#lib/chase/workspace";

/**
 * From a verified change in the sandbox to commits on GitHub: which files go
 * in which commit, where they go, and what came of it.
 *
 * @remarks
 * The model proposes the commits (a message and the paths for each); this
 * checks that they cover the change exactly once and read like the
 * maintainer's own. Where they go is decided from GitHub at the moment of
 * the push (`./branch.ts`), after reading the pull request again: a head that
 * moved while the chase worked is someone else's newer work, and the chase
 * stops rather than pile on top of it.
 */

/** One commit the model asks for. */
export interface CommitRequest {
  readonly message: string;
  readonly paths: readonly string[];
}

/** A requested commit with the changes it carries. */
export interface CommitGroup {
  readonly changes: readonly ChangedPath[];
  readonly message: string;
}

export type Grouping =
  | { readonly groups: readonly CommitGroup[]; readonly ok: true }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Splits the change into the requested commits, or lists everything wrong
 * with the request: a bad message, a path that did not change, a path in two
 * commits, a changed path in none, a path that may not be pushed (outside the
 * repository, under `.github/workflows`), a file that is not a regular one, or
 * a change too large for a fix. `modes` is the index's mode for each path.
 */
export const groupCommits = (
  changes: readonly ChangedPath[],
  requested: readonly CommitRequest[],
  modes: ReadonlyMap<string, string>
): Grouping => {
  const problems: string[] = [];
  if (changes.length === 0) {
    problems.push("Nothing changed in the repository.");
  }
  if (changes.length > MAX_CHANGED_FILES) {
    problems.push(
      `${changes.length} files changed, more than the ${MAX_CHANGED_FILES} a fix may touch.`
    );
  }
  for (const change of changes) {
    const problem = pathProblem(change.path);
    if (problem !== null) {
      problems.push(problem);
    }
  }
  problems.push(...modeProblems(changes, modes));
  const byPath = new Map(changes.map((change) => [change.path, change]));
  const claimed = new Map<string, number>();
  for (const [index, commit] of requested.entries()) {
    for (const problem of commitMessageProblems(commit.message)) {
      problems.push(`Commit ${index + 1}: ${problem}`);
    }
    if (commit.paths.length === 0) {
      problems.push(`Commit ${index + 1} names no file.`);
    }
    for (const path of commit.paths) {
      if (!byPath.has(path)) {
        problems.push(
          `Commit ${index + 1} names ${path}, which did not change.`
        );
      }
      const earlier = claimed.get(path);
      if (earlier !== undefined) {
        problems.push(
          `${path} is in commit ${earlier} and commit ${index + 1}.`
        );
      }
      claimed.set(path, index + 1);
    }
  }
  for (const change of changes) {
    if (!claimed.has(change.path)) {
      problems.push(`${change.path} changed but is in no commit.`);
    }
  }
  if (requested.length === 0) {
    problems.push("Name at least one commit.");
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    groups: requested.map((commit) => ({
      changes: commit.paths.flatMap((path) => {
        const change = byPath.get(path);
        return change === undefined ? [] : [change];
      }),
      message: commit.message.trim(),
    })),
    ok: true,
  };
};

const PULL = z.object({ head: z.object({ sha: z.string() }) });
const REPOSITORY = z.object({
  default_branch: z.string(),
  full_name: z.string(),
});
const PULL_HEAD = z.object({
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
});
const BRANCH = z.object({ protected: z.boolean() });

const readHead = async (
  send: GitHubSend,
  task: ChaseCheckout
): Promise<string | null> => {
  const response = await send(
    `/repos/${task.repository}/pulls/${task.pullRequest}`,
    { method: "GET" }
  );
  return response.status === 200
    ? (PULL.safeParse(response.body).data?.head.sha ?? null)
    : null;
};

/** What GitHub says about the branch now; an unreadable protection reads as protected. */
const readBranchFacts = async (
  send: GitHubSend,
  task: ChaseCheckout
): Promise<BranchFacts | null> => {
  const [repository, pull, branch] = await Promise.all([
    send(`/repos/${task.repository}`, { method: "GET" }),
    send(`/repos/${task.repository}/pulls/${task.pullRequest}`, {
      method: "GET",
    }),
    send(
      `/repos/${task.repository}/branches/${encodeURIComponent(task.headRef)}`,
      { method: "GET" }
    ),
  ]);
  const repo = REPOSITORY.safeParse(repository.body).data;
  const head = PULL_HEAD.safeParse(pull.body).data;
  if (repository.status !== 200 || repo === undefined || head === undefined) {
    return null;
  }
  const protection =
    branch.status === 200 ? BRANCH.safeParse(branch.body).data : undefined;
  return {
    baseRepository: repo.full_name,
    defaultBranch: repo.default_branch,
    headProtected: protection?.protected ?? true,
    headRef: head.head.ref,
    headRepository: head.head.repo?.full_name ?? null,
    headSha: task.headSha,
    pullRequest: task.pullRequest,
  };
};

export interface Delivery {
  readonly checks: readonly ChaseCheck[];
  readonly commits: readonly CommitPlan[];
  /** The fix pull request's body, when the head branch cannot be pushed to. */
  readonly pullRequestBody: string;
  readonly send: GitHubSend;
  readonly task: ChaseCheckout;
}

const outcome = (
  delivery: Delivery,
  fields: Pick<ChaseResult, "reason" | "status"> &
    Partial<Pick<ChaseResult, "branch" | "fixPullRequest">> & {
      readonly commits?: readonly string[];
    }
): ChaseResult => ({
  branch: fields.branch ?? null,
  checks: [...delivery.checks],
  commits: [...(fields.commits ?? [])],
  fixPullRequest: fields.fixPullRequest ?? null,
  headSha: delivery.task.headSha,
  notVerified:
    fields.status === "pushed" || fields.status === "opened-pull-request"
      ? []
      : ["No fix was pushed."],
  output: "",
  pullRequest: delivery.task.url,
  reason: fields.reason,
  status: fields.status,
});

/** GitHub's answer to a write the token may not make. */
const FORBIDDEN = 403;

const SUPERSEDED =
  "The head moved while the chase worked, so the fix was not pushed on top of newer work.";

const openPullRequest = async (
  delivery: Delivery,
  plan: Extract<PushPlan, { kind: "pull-request" }>,
  shas: readonly string[]
): Promise<ChaseResult> => {
  const pull = await openFixPullRequest({
    base: plan.base,
    body: delivery.pullRequestBody,
    branch: plan.branch,
    repository: delivery.task.repository,
    send: delivery.send,
    sha: shas.at(-1) ?? delivery.task.headSha,
    title:
      delivery.commits[0]?.message.split("\n")[0] ??
      "fix: make the checks pass",
  });
  return outcome(delivery, {
    branch: plan.branch,
    commits: shas,
    fixPullRequest: pull.url,
    reason: `Opened ${pull.url} against ${plan.base}, which could not be pushed to.`,
    status: "opened-pull-request",
  });
};

/**
 * Pushes the commits where the branch rule says, and answers what happened.
 * Throws only on a GitHub answer the Git Data calls did not expect.
 */
export const deliverFix = async (delivery: Delivery): Promise<ChaseResult> => {
  const { send, task } = delivery;
  if ((await readHead(send, task)) !== task.headSha) {
    return outcome(delivery, { reason: SUPERSEDED, status: "superseded" });
  }
  const facts = await readBranchFacts(send, task);
  if (facts === null) {
    return outcome(delivery, {
      reason: `GitHub would not describe ${task.repository}, so nothing was pushed.`,
      status: "failed",
    });
  }
  const plan = planPush(facts);
  if (plan.kind === "refuse") {
    return outcome(delivery, {
      reason: REFUSAL_REASONS[plan.reason],
      status: "failed",
    });
  }
  const shas = await createCommits({
    commits: delivery.commits,
    parentSha: task.headSha,
    repository: task.repository,
    send,
  });
  if (plan.kind === "pull-request") {
    return openPullRequest(delivery, plan, shas);
  }
  const pushed = await fastForward({
    branch: plan.branch,
    repository: task.repository,
    send,
    sha: shas.at(-1) ?? task.headSha,
  });
  if (pushed.ok) {
    return outcome(delivery, {
      branch: plan.branch,
      commits: shas,
      reason: `Pushed ${shas.length} commit${shas.length === 1 ? "" : "s"} to ${plan.branch}; its checks run again on the new head.`,
      status: "pushed",
    });
  }
  if (pushed.status === FORBIDDEN) {
    return outcome(delivery, {
      reason: REFUSAL_REASONS["no-write"],
      status: "failed",
    });
  }
  if ((await readHead(send, task)) !== task.headSha) {
    return outcome(delivery, { reason: SUPERSEDED, status: "superseded" });
  }
  const fallback = fallBackToPullRequest(facts);
  return fallback.kind === "pull-request"
    ? openPullRequest(delivery, fallback, shas)
    : outcome(delivery, {
        reason: `GitHub refused the push (${pushed.status}).`,
        status: "failed",
      });
};
