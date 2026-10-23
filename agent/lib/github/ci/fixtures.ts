import { z } from "zod";

import type { GitHubRequest } from "#lib/github/checks";
import type { RedEvent } from "#lib/github/ci/event";
import type { PullRequestFacts } from "#lib/github/ci/pull-request";
import type { FetchLike } from "#lib/slack/notify";

/** Shared by the chase's tests: a GitHub that answers from a table, and the facts it describes. */
export const HEAD = "3c41196471a0ba382508ce887681b1403f1a47cd";

export const OWNER = "PunGrumpy";
export const REPO = "baymi";
export const BASE = `/repos/${OWNER}/${REPO}`;

export const pullRequestFacts = (
  overrides: Partial<PullRequestFacts> = {}
): PullRequestFacts => ({
  draft: false,
  head: { sha: HEAD },
  state: "open",
  title: "feat: a thing",
  user: { login: OWNER, type: "User" },
  ...overrides,
});

export const workflowEvent = (overrides: Partial<RedEvent> = {}): RedEvent => ({
  attempt: 1,
  checkName: "CI",
  conclusion: "failure",
  eventId: 77,
  headSha: HEAD,
  kind: "workflow-run",
  pullRequest: 7,
  summary: null,
  ...overrides,
});

/** What GitHub answers: JSON, or text for a log. */
export type GitHubAnswer =
  | string
  | number
  | boolean
  | null
  | readonly GitHubAnswer[]
  | { readonly [key: string]: GitHubAnswer };

/** Paths mapped to what GitHub answers there. */
export type GitHubAnswers = Readonly<Record<string, GitHubAnswer>>;

/** A GitHub that answers a path from a table, throws for one it lacks, and remembers what it was asked. */
export const fakeGitHub = (answers: GitHubAnswers) => {
  const asked: string[] = [];
  const request: GitHubRequest = ({ path }) => {
    asked.push(path);
    if (!(path in answers)) {
      return Promise.reject(new Error(`GitHub answered 404 for ${path}.`));
    }
    return Promise.resolve({ body: answers[path] });
  };
  return { asked, request };
};

const stamp = "2026-10-22T18:44:39.1234567Z";

/** An Actions log tail with the closing exit-code line. */
export const actionsLog = (...lines: string[]): string =>
  [...lines, "##[error]Process completed with exit code 1."]
    .map((line) => `${stamp} ${line}`)
    .join("\n");

export const RUN_PATH = `${BASE}/actions/runs/77`;
export const JOBS_PATH = `${RUN_PATH}/jobs?filter=latest&per_page=100`;
export const FILES_PATH = `${BASE}/pulls/7/files?per_page=100`;
/** The base branch's latest completed run of workflow 9, and that run's jobs. */
export const BASE_RUNS_PATH = `${BASE}/actions/workflows/9/runs?branch=main&status=completed&exclude_pull_requests=true&per_page=1`;
export const BASE_JOBS_PATH = `${BASE}/actions/runs/500/jobs?filter=latest&per_page=100`;
export const PULL_PATH = `${BASE}/pulls/7`;
export const logPath = (jobId: number): string =>
  `${BASE}/actions/jobs/${jobId}/logs`;

/** The fields of a post the fake keeps, as `chat.postMessage` receives them. */
const POST = z.looseObject({
  metadata: z.object({
    event_payload: z.object({ key: z.string() }),
    event_type: z.string(),
  }),
  text: z.string(),
});

/**
 * A Slack channel that keeps what was posted and answers history from it,
 * shared by every "instance" a test starts, the way the real channel is.
 */
export const fakeSlackChannel = (
  history: "readable" | "unreadable" = "readable"
) => {
  const posted: z.infer<typeof POST>[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    const method = input.split("/").at(-1) ?? "";
    if (method === "chat.postMessage") {
      posted.push(POST.parse(JSON.parse(init.body)));
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true, ts: `${posted.length}.0` }),
      });
    }
    const answer =
      history === "unreadable"
        ? { error: "not_in_channel", ok: false }
        : {
            messages: posted.map(({ metadata }) => ({ metadata })),
            ok: true,
          };
    return Promise.resolve({ json: () => Promise.resolve(answer) });
  };
  return { fetchImpl, posted };
};
