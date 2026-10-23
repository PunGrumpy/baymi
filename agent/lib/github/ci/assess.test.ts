import { describe, expect, it } from "vitest";

import { assessCiFailure } from "#lib/github/ci/assess";
import {
  actionsLog,
  BASE_JOBS_PATH,
  BASE_RUNS_PATH,
  FILES_PATH,
  filesPath,
  JOBS_PATH,
  OWNER,
  REPO,
  RUN_PATH,
  fakeGitHub,
  HEAD,
  logPath,
  pullRequestFacts,
  workflowEvent,
} from "#lib/github/ci/fixtures";
import type { GitHubAnswers } from "#lib/github/ci/fixtures";

const target = (event = workflowEvent()) => ({
  event,
  owner: OWNER,
  pullRequest: pullRequestFacts(),
  repo: REPO,
});

const run = { conclusion: "failure", run_attempt: 1 };
const files = [{ filename: "src/server.ts" }, { filename: "README.md" }];

const job = (id: number, name: string, conclusion = "failure") => ({
  conclusion,
  id,
  name,
});

/** A pull request against `main`, whose latest run of workflow 9 the base answers are about. */
const onBase = () => ({
  event: workflowEvent(),
  owner: OWNER,
  pullRequest: pullRequestFacts({ base: { ref: "main" } }),
  repo: REPO,
});

describe(assessCiFailure, () => {
  it("classifies a failed job's log against the diff and returns the head it was made on", async () => {
    const { request } = fakeGitHub({
      [FILES_PATH]: files,
      [JOBS_PATH]: { jobs: [job(1, "build", "success"), job(2, "test")] },
      [RUN_PATH]: run,
      [logPath(2)]: actionsLog("FAIL src/server.test.ts", "AssertionError: no"),
    });
    const assessment = await assessCiFailure(request, target());
    expect(assessment).toMatchObject({
      attempt: 1,
      conclusion: "failure",
      headSha: HEAD,
      jobName: "test",
      pullRequest: 7,
      runId: 77,
    });
    expect(assessment.classification.kind).toBe("own-code");
  });

  it("takes the attempt from GitHub, which can be ahead of the event", async () => {
    const { request } = fakeGitHub({
      [FILES_PATH]: files,
      [JOBS_PATH]: { jobs: [job(2, "test")] },
      [RUN_PATH]: { conclusion: "failure", run_attempt: 2 },
      [logPath(2)]: actionsLog("Error: connect ECONNRESET 1.2.3.4:443"),
    });
    const assessment = await assessCiFailure(request, target());
    expect(assessment.attempt).toBe(2);
    expect(assessment.classification.kind).toBe("flake");
  });

  it("lets the worst job decide: a flake does not hide a real failure", async () => {
    const { request } = fakeGitHub({
      [FILES_PATH]: files,
      [JOBS_PATH]: { jobs: [job(1, "lint"), job(2, "test")] },
      [RUN_PATH]: run,
      [logPath(1)]: actionsLog("Error: connect ECONNRESET 1.2.3.4:443"),
      [logPath(2)]: actionsLog("FAIL src/server.test.ts"),
    });
    const assessment = await assessCiFailure(request, target());
    expect(assessment.jobName).toBe("test");
    expect(assessment.classification.kind).toBe("own-code");
  });

  it("reads a job's log only for jobs that failed, and at most three", async () => {
    const { asked, request } = fakeGitHub({
      [FILES_PATH]: files,
      [JOBS_PATH]: {
        jobs: [1, 2, 3, 4, 5].map((id) => job(id, `job-${id}`)),
      },
      [RUN_PATH]: run,
      [logPath(1)]: actionsLog("x"),
      [logPath(2)]: actionsLog("x"),
      [logPath(3)]: actionsLog("x"),
    });
    await assessCiFailure(request, target());
    expect(asked.filter((path) => path.endsWith("/logs"))).toHaveLength(3);
  });

  it("degrades to unknown when the log cannot be read", async () => {
    const { request } = fakeGitHub({
      [FILES_PATH]: files,
      [JOBS_PATH]: { jobs: [job(2, "test")] },
      [RUN_PATH]: run,
    });
    const assessment = await assessCiFailure(request, target());
    expect(assessment.classification).toMatchObject({
      kind: "unknown",
      reason: "no-log",
    });
    expect(assessment.jobName).toBe("test");
  });

  it("degrades to unknown, with the event's own facts, when nothing can be read", async () => {
    const { request } = fakeGitHub({});
    const assessment = await assessCiFailure(
      request,
      target(workflowEvent({ attempt: 2, checkName: "CI" }))
    );
    expect(assessment).toMatchObject({
      attempt: 2,
      conclusion: "failure",
      jobName: "CI",
      runId: 77,
    });
    expect(assessment.classification.kind).toBe("unknown");
  });

  it("does not guess own code from a diff it could not list", async () => {
    const { request } = fakeGitHub({
      [JOBS_PATH]: { jobs: [job(2, "test")] },
      [RUN_PATH]: run,
      [logPath(2)]: actionsLog("FAIL src/server.test.ts"),
    });
    const assessment = await assessCiFailure(request, target());
    expect(assessment.classification.kind).toBe("unknown");
  });

  it("reads every changed file, not only the first hundred", async () => {
    const others = Array.from({ length: 100 }, (_, index) => ({
      filename: `docs/page-${index}.md`,
    }));
    const { request } = fakeGitHub({
      [filesPath(1)]: others,
      [filesPath(2)]: [{ filename: "src/server.ts" }],
      [JOBS_PATH]: { jobs: [job(2, "test")] },
      [RUN_PATH]: run,
      [logPath(2)]: actionsLog("FAIL src/server.test.ts"),
    });
    const assessment = await assessCiFailure(request, target());
    expect(assessment.classification).toMatchObject({
      files: ["src/server.test.ts"],
      kind: "own-code",
    });
  });

  describe("a failure outside the diff", () => {
    const outside: GitHubAnswers = {
      [FILES_PATH]: files,
      [JOBS_PATH]: { jobs: [job(2, "test")] },
      [RUN_PATH]: { ...run, workflow_id: 9 },
      [logPath(2)]: actionsLog(
        "src/consumer.ts(3,10): error TS2305: Module './api' has no exported member 'fetchUser'."
      ),
    };

    it("is a stale base when the same job fails on the base branch's latest run", async () => {
      const { request } = fakeGitHub({
        ...outside,
        [BASE_JOBS_PATH]: { jobs: [job(8, "test")] },
        [BASE_RUNS_PATH]: {
          workflow_runs: [{ conclusion: "failure", id: 500 }],
        },
      });
      const assessment = await assessCiFailure(request, onBase());
      expect(assessment.classification).toMatchObject({
        kind: "stale-base",
        reason: "outside-diff",
      });
    });

    it("is the diff's own code when the base branch's latest run passed", async () => {
      const { asked, request } = fakeGitHub({
        ...outside,
        [BASE_RUNS_PATH]: {
          workflow_runs: [{ conclusion: "success", id: 500 }],
        },
      });
      const assessment = await assessCiFailure(request, onBase());
      expect(assessment.classification).toMatchObject({
        kind: "own-code",
        reason: "breaks-caller",
      });
      expect(asked).not.toContain(BASE_JOBS_PATH);
    });

    it("is the diff's own code when the base's run failed in another job", async () => {
      const { request } = fakeGitHub({
        ...outside,
        [BASE_JOBS_PATH]: {
          jobs: [job(8, "lint"), job(9, "test", "success")],
        },
        [BASE_RUNS_PATH]: {
          workflow_runs: [{ conclusion: "failure", id: 500 }],
        },
      });
      const assessment = await assessCiFailure(request, onBase());
      expect(assessment.classification.reason).toBe("breaks-caller");
    });

    it("is not guessed when the base cannot be read", async () => {
      const { request } = fakeGitHub(outside);
      const assessment = await assessCiFailure(request, onBase());
      expect(assessment.classification).toMatchObject({
        kind: "unknown",
        reason: "base-unread",
      });
    });
  });

  it("assesses an external check from its own summary without reading anything", async () => {
    const { asked, request } = fakeGitHub({});
    const assessment = await assessCiFailure(
      request,
      target(
        workflowEvent({
          attempt: 1,
          checkName: "GitGuardian Security Checks",
          eventId: 5,
          kind: "external-check",
          summary: "1 secret incident found",
        })
      )
    );
    expect(asked).toStrictEqual([]);
    expect(assessment).toMatchObject({
      attempt: 1,
      jobName: "GitGuardian Security Checks",
      runId: null,
    });
    expect(assessment.classification).toMatchObject({
      kind: "external",
      line: "1 secret incident found",
    });
  });
});
