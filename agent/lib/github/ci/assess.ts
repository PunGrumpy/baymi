import { z } from "zod";

import type { GitHubRequest } from "#lib/github/checks";
import { classifyExternal, classifyFailure } from "#lib/github/ci/classify";
import type { Classification, FailureKind } from "#lib/github/ci/classify";
import type { RedEvent } from "#lib/github/ci/event";
import type { PullRequestFacts } from "#lib/github/ci/pull-request";

/**
 * Reads what GitHub knows about a red check and says what it was.
 *
 * @remarks
 * This is the seam unit C1 calls. It takes the event and the pull request as
 * the filter already read them, and returns the classification together with
 * the pull request's head, so a fix is made against the commit the failure
 * was found on and is not made at all if the head has moved by then. It
 * writes nothing and runs nothing: the log is read as text and matched
 * against patterns (`./classify.ts`), never executed.
 *
 * A read that fails does not stop the chase. A run whose log expired, or a
 * token without Actions read, degrades to `unknown`, which is spoken to the
 * maintainer, because silence on a red check nobody could read is the worse
 * outcome.
 */

/** The jobs worth reading a log for; a run with more failures has one cause per job anyway. */
const MAX_LOGS_READ = 3;

/** The tail is where the failing step's error is; the head of a log is setup. */
const LOG_TAIL_LINES = 400;

const PAGE = 100;

const RUN = z.object({
  conclusion: z.string().nullable(),
  run_attempt: z.number().int().positive(),
});

const JOBS = z.object({
  jobs: z.array(
    z.object({
      conclusion: z.string().nullable(),
      id: z.number().int(),
      name: z.string(),
    })
  ),
});

const FILES = z.array(z.object({ filename: z.string() }));

const FAILED_JOB_CONCLUSIONS: ReadonlySet<string> = new Set([
  "cancelled",
  "failure",
  "timed_out",
]);

/** The worst of several jobs' kinds decides the run: a flake never hides a real failure. */
const SEVERITY: Readonly<Record<FailureKind, number>> = {
  external: 4,
  flake: 0,
  "own-code": 3,
  "stale-base": 2,
  unknown: 1,
};

export interface CiAssessment {
  /** The run's attempt now, which can be ahead of the event's. */
  readonly attempt: number;
  readonly classification: Classification;
  readonly conclusion: string;
  /** The pull request's head the assessment was made against. */
  readonly headSha: string;
  /** The failed job, or the external check, the line is about. */
  readonly jobName: string;
  readonly pullRequest: number;
  /** `null` for an external check, which has no run. */
  readonly runId: number | null;
}

export interface AssessTarget {
  readonly event: RedEvent;
  readonly owner: string;
  readonly pullRequest: PullRequestFacts;
  readonly repo: string;
}

const tail = (log: string): string =>
  log.split("\n").slice(-LOG_TAIL_LINES).join("\n");

/** Runs a read and gives `null` for any failure, which the caller treats as unknown. */
const soft = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

const getJson = async <T>(
  request: GitHubRequest,
  path: string,
  schema: z.ZodType<T>
): Promise<T> => {
  const response = await request({ method: "GET", path });
  return schema.parse(response.body);
};

const getText = async (
  request: GitHubRequest,
  path: string
): Promise<string> => {
  const response = await request({ method: "GET", path });
  return z.string().parse(response.body);
};

const readDiffFiles = (
  request: GitHubRequest,
  target: AssessTarget
): Promise<readonly string[] | null> =>
  soft(async () => {
    const files = await getJson(
      request,
      `/repos/${target.owner}/${target.repo}/pulls/${target.event.pullRequest}/files?per_page=${PAGE}`,
      FILES
    );
    return files.map((file) => file.filename);
  });

interface JobLog {
  readonly classification: Classification;
  readonly name: string;
}

const classifyJobs = async (
  request: GitHubRequest,
  target: AssessTarget,
  runId: number,
  diffFiles: readonly string[]
): Promise<readonly JobLog[]> => {
  const jobs = await soft(() =>
    getJson(
      request,
      `/repos/${target.owner}/${target.repo}/actions/runs/${runId}/jobs?filter=latest&per_page=${PAGE}`,
      JOBS
    )
  );
  const failed = (jobs?.jobs ?? [])
    .filter((job) => FAILED_JOB_CONCLUSIONS.has(job.conclusion ?? ""))
    .slice(0, MAX_LOGS_READ);
  return Promise.all(
    failed.map(async (job) => {
      const log = await soft(() =>
        getText(
          request,
          `/repos/${target.owner}/${target.repo}/actions/jobs/${job.id}/logs`
        )
      );
      return {
        classification: classifyFailure({
          diffFiles,
          log: log === null ? null : tail(log),
        }),
        name: job.name,
      };
    })
  );
};

/** The job whose kind is worst; ties keep the first, which is GitHub's order. */
const worst = (jobs: readonly JobLog[]): JobLog | null => {
  let chosen: JobLog | null = null;
  for (const job of jobs) {
    if (
      chosen === null ||
      SEVERITY[job.classification.kind] > SEVERITY[chosen.classification.kind]
    ) {
      chosen = job;
    }
  }
  return chosen;
};

/**
 * Classifies a red check against the pull request it is on.
 *
 * @remarks
 * `diffFiles` is read once and passed to every job. A diff GitHub will not
 * list leaves `own-code` unreachable: every failing file then reads as
 * outside it, so an unreadable diff classifies as `unknown` instead.
 */
export const assessCiFailure = async (
  request: GitHubRequest,
  target: AssessTarget
): Promise<CiAssessment> => {
  const { event } = target;
  const base = {
    headSha: target.pullRequest.head.sha,
    pullRequest: event.pullRequest,
  };
  if (event.kind === "external-check") {
    return {
      ...base,
      attempt: 1,
      classification: classifyExternal(event.summary),
      conclusion: event.conclusion,
      jobName: event.checkName,
      runId: null,
    };
  }
  const run = await soft(() =>
    getJson(
      request,
      `/repos/${target.owner}/${target.repo}/actions/runs/${event.eventId}`,
      RUN
    )
  );
  const diffFiles = await readDiffFiles(request, target);
  const jobs =
    diffFiles === null
      ? []
      : await classifyJobs(request, target, event.eventId, diffFiles);
  const chosen = worst(jobs);
  return {
    ...base,
    attempt: run?.run_attempt ?? event.attempt,
    classification: chosen?.classification ?? {
      files: [],
      kind: "unknown",
      line: null,
      reason: "no-log",
    },
    conclusion: run?.conclusion ?? event.conclusion,
    jobName: chosen?.name ?? event.checkName,
    runId: event.eventId,
  };
};
