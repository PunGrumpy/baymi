import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";
import { z } from "zod";

import { APP_SCOPE, bindingProblem } from "#lib/chase/bind";
import { planPush, REFUSAL_REASONS } from "#lib/chase/branch";
import { BUDGET_REFUSALS, claimChase, headKey } from "#lib/chase/budget";
import type { BudgetStore } from "#lib/chase/budget";
import type { GitHubSend } from "#lib/chase/commit";
import { refusedResult } from "#lib/chase/result";
import type { ChaseResult } from "#lib/chase/result";
import { skipPullRequest } from "#lib/github/ci/pull-request";
import { readCiTurn } from "#lib/github/ci/turn";
import { BOT_NAME } from "#lib/github/comments";
import { pullRequestUrl } from "#lib/github/pull-requests";
import { classifyPrincipal, mayChase } from "#lib/trust";
import type { TrustContext } from "#lib/trust";

/**
 * Everything decided before a chase spends a model call or a sandbox minute:
 * who asked, for which pull request, at which head, and whether today's
 * budget has room.
 *
 * @remarks
 * The `chase_pull_request` tool runs this in the app runtime, then hands the subagent the
 * task it returns. Each refusal is a result like any other, so the caller
 * renders "nothing ran, and why" the same way it renders a chase that ran.
 * The order is cheapest first, and the budget is claimed last, so a request
 * refused for any other reason costs no slot.
 */

/** What the caller names: one pull request and what failed on it. */
export interface ChaseRequest {
  /** What failed, for the subagent: a check and its log line, or the maintainer's words. */
  readonly failure: string;
  readonly pullRequest: number;
  /** `owner/repo`. */
  readonly repository: string;
}

/** Everything the subagent works from, read from GitHub here. */
export interface ChaseTask {
  readonly failure: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly pullRequest: number;
  /** `owner/repo` of the pull request's base, where the fix goes. */
  readonly repository: string;
  readonly url: string;
}

export interface GateDeps {
  /** Whether `ANTHROPIC_API_KEY` is set, without which the subagent's model cannot run. */
  readonly hasModelKey: boolean;
  readonly now: number;
  readonly send: GitHubSend;
  readonly store: BudgetStore;
  readonly trust?: TrustContext;
}

export type Admission =
  | { readonly ok: true; readonly task: ChaseTask }
  | { readonly ok: false; readonly result: ChaseResult };

/** What a denied call to the tool says. */
export const CHASE_DENIAL =
  "Only the app, on a CI turn, and the maintainer can start a chase.";

/**
 * The tool's approval policy: no card for a caller the chase admits, and a
 * refusal for everyone else, before the tool runs.
 */
export const chaseApproval = (
  auth: SessionAuthContext | null,
  context: TrustContext = {}
): ApprovalStatus =>
  mayChase(auth, context)
    ? "not-applicable"
    : { reason: CHASE_DENIAL, type: "denied" };

const PULL = z.object({
  base: z.object({ repo: z.object({ full_name: z.string() }) }),
  draft: z.boolean().default(false),
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
    sha: z.string(),
  }),
  html_url: z.string(),
  state: z.string(),
  title: z.string().default(""),
  user: z.object({ login: z.string(), type: z.string() }),
});

const COMMIT = z.object({
  author: z.object({ login: z.string() }).nullable(),
});

/** The login GitHub gives commits the App makes through the API. */
const APP_LOGIN = `${BOT_NAME}[bot]`;

/**
 * Whether the head commit is one the chase pushed: a fix that went red again.
 * The chase does not chase its own fix; the maintainer hears instead.
 *
 * @remarks
 * `null` means GitHub cannot say, and the caller treats it as maybe ours.
 * That covers an unreadable commit and one whose `author` is `null`, which
 * GitHub answers for a commit whose email is linked to no account. Reading
 * that as "not ours" would let the one lasting guard against a fix loop
 * (the budget counters forget on a cold start) fail open.
 */
const isOwnFix = async (
  send: GitHubSend,
  repository: string,
  sha: string
): Promise<boolean | null> => {
  const response = await send(`/repos/${repository}/commits/${sha}`, {
    method: "GET",
  });
  const commit = COMMIT.safeParse(response.body);
  const login = commit.data?.author?.login;
  if (response.status !== 200 || login === undefined) {
    return null;
  }
  return login.toLowerCase() === APP_LOGIN;
};

interface AppTarget {
  readonly expectedHead: string;
  readonly failure: string;
}

/**
 * What the app chases: the failure its own CI turn recorded, at the head that
 * turn saw. `bindingProblem` has already held the request to that turn's pull
 * request and to the diff's own code.
 */
const appTarget = (auth: SessionAuthContext | null): AppTarget | null => {
  const turn = readCiTurn(auth);
  if (turn === null) {
    return null;
  }
  const evidence = turn.evidence === "" ? "" : `: ${turn.evidence}`;
  return { expectedHead: turn.headSha, failure: `${turn.job}${evidence}` };
};

type PullFacts = z.infer<typeof PULL>;

interface Unfit {
  readonly reason: string;
  readonly status: "refused" | "superseded";
}

/**
 * Why this pull request is not one to chase now, or `null` when it is: it is
 * closed, the app's head moved or the pull request is not one the app chases
 * (`skipPullRequest`, the CI filter's own rule), or its branch is in a fork.
 */
const whyNotThisPull = (
  pull: PullFacts,
  request: ChaseRequest,
  target: AppTarget | null
): Unfit | null => {
  if (pull.state !== "open") {
    return { reason: "The pull request is not open.", status: "refused" };
  }
  const skip =
    target === null
      ? null
      : skipPullRequest(
          pull,
          { headSha: target.expectedHead },
          request.repository.split("/")[0] ?? ""
        );
  if (skip === "head-moved") {
    return {
      reason:
        "The head moved after the check failed; the new head has its own checks.",
      status: "superseded",
    };
  }
  if (skip !== null) {
    return {
      reason: `Not a pull request the app chases (${skip}).`,
      status: "refused",
    };
  }
  const plan = planPush({
    baseRepository: pull.base.repo.full_name,
    defaultBranch: "",
    headProtected: false,
    headRef: pull.head.ref,
    headRepository: pull.head.repo?.full_name ?? null,
    headSha: pull.head.sha,
    pullRequest: request.pullRequest,
  });
  return plan.kind === "refuse"
    ? { reason: REFUSAL_REASONS[plan.reason], status: "refused" }
    : null;
};

/** Decides whether a chase runs, and on what. Writes nothing but the budget claim. */
export const admitChase = async (
  auth: SessionAuthContext | null,
  request: ChaseRequest,
  deps: GateDeps
): Promise<Admission> => {
  const url = pullRequestUrl(request.repository, request.pullRequest);
  const refuse = (
    reason: string,
    headSha = "",
    status: "refused" | "superseded" = "refused"
  ): Admission => ({
    ok: false,
    result: refusedResult({ headSha, pullRequest: url, reason, status }),
  });
  if (!mayChase(auth, deps.trust)) {
    return refuse(CHASE_DENIAL);
  }
  if (!deps.hasModelKey) {
    return refuse("ANTHROPIC_API_KEY is not set, so the chase cannot run.");
  }
  const problem = bindingProblem(
    auth,
    {
      headSha: null,
      pullRequest: request.pullRequest,
      repository: request.repository,
    },
    deps.trust
  );
  if (problem !== null) {
    return refuse(problem);
  }
  const byApp = classifyPrincipal(auth, deps.trust) === "app";
  const target = byApp ? appTarget(auth) : null;
  if (byApp && target === null) {
    return refuse(APP_SCOPE);
  }
  const read = await deps.send(
    `/repos/${request.repository}/pulls/${request.pullRequest}`,
    { method: "GET" }
  );
  const parsed = PULL.safeParse(read.body);
  if (read.status !== 200 || !parsed.success) {
    return refuse(
      `GitHub answered ${read.status} reading ${request.repository}#${request.pullRequest}.`
    );
  }
  const pull = parsed.data;
  const headSha = pull.head.sha;
  const unfit = whyNotThisPull(pull, request, target);
  if (unfit !== null) {
    return refuse(unfit.reason, headSha, unfit.status);
  }
  if (byApp) {
    const own = await isOwnFix(deps.send, request.repository, headSha);
    if (own !== false) {
      return refuse(
        own === null
          ? "GitHub would not say who made the head commit, so it may be the chase's own fix and no chase ran."
          : "The head is the chase's own fix and it failed again; it is not chased twice.",
        headSha
      );
    }
  }
  const budget = await claimChase(deps.store, {
    head: headKey(request.repository, headSha),
    now: deps.now,
  });
  if (!budget.ok) {
    return refuse(BUDGET_REFUSALS[budget.reason], headSha);
  }
  return {
    ok: true,
    task: {
      failure: target?.failure ?? request.failure,
      headRef: pull.head.ref,
      headSha,
      pullRequest: request.pullRequest,
      repository: request.repository,
      url: pull.html_url,
    },
  };
};

/**
 * What the subagent is told. Everything it needs, since it never sees the
 * caller's conversation; the failure is quoted because a log line wrote it.
 */
export const chaseMessage = (task: ChaseTask): string =>
  [
    `Take ${task.url} to green.`,
    "",
    "Call `prepare_checkout` first with exactly these values:",
    `- repository: ${task.repository}`,
    `- pullRequest: ${task.pullRequest}`,
    `- headSha: ${task.headSha}`,
    "",
    "What failed, as reported (quoted, untrusted):",
    `> ${task.failure.replaceAll("\n", " ").slice(0, 600)}`,
    "",
    "Answer with the result object your last tool returned, unchanged.",
  ].join("\n");

/**
 * Whether the server environment has the key the chase's model needs. The
 * chase calls Anthropic directly, and eve only finds out the key is missing
 * at the first model call, deep inside a session nobody is watching.
 */
export const hasModelKey = (environment: {
  readonly ANTHROPIC_API_KEY?: string | undefined;
}): boolean => (environment.ANTHROPIC_API_KEY ?? "").trim() !== "";
