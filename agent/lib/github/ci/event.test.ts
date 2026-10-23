import type {
  GitHubCheckRunEvent,
  GitHubWorkflowRunEvent,
} from "eve/channels/github";
import { describe, expect, it } from "vitest";

import { readCheckRun, readWorkflowRun } from "#lib/github/ci/event";

const HEAD = "3c41196471a0ba382508ce887681b1403f1a47cd";

/** `raw` is the `workflow_run` object eve hands the hook, not the envelope. */
const workflow = (
  overrides: Partial<GitHubWorkflowRunEvent> = {}
): GitHubWorkflowRunEvent => ({
  action: "completed",
  app: { slug: "github-actions" },
  conclusion: "failure",
  headSha: HEAD,
  pullRequests: [7],
  raw: { id: 31_186_387_698, name: "CI", run_attempt: 1 },
  status: "completed",
  workflowRunId: 31_186_387_698,
  ...overrides,
});

const check = (
  overrides: Partial<GitHubCheckRunEvent> = {}
): GitHubCheckRunEvent => ({
  action: "completed",
  app: { slug: "gitguardian" },
  checkRunId: 120_017_478_747,
  conclusion: "failure",
  headSha: HEAD,
  pullRequests: [7],
  raw: {
    id: 120_017_478_747,
    name: "GitGuardian Security Checks",
    output: { summary: "1 secret incident found", title: "Secrets" },
  },
  status: "completed",
  ...overrides,
});

describe(readWorkflowRun, () => {
  it("starts on a finished run that failed, and carries its attempt", () => {
    const verdict = readWorkflowRun(
      workflow({ raw: { id: 1, name: "CI", run_attempt: 2 } })
    );
    expect(verdict).toStrictEqual({
      event: {
        attempt: 2,
        checkName: "CI",
        conclusion: "failure",
        eventId: 31_186_387_698,
        headSha: HEAD,
        kind: "workflow-run",
        pullRequest: 7,
        summary: null,
      },
      ok: true,
    });
  });

  it("starts on a timeout, and on a cancelled run whose log the chase reads for one", () => {
    for (const conclusion of ["timed_out", "cancelled"]) {
      expect(readWorkflowRun(workflow({ conclusion })).ok).toBeTruthy();
    }
  });

  it("skips a success, a neutral run and one with no conclusion", () => {
    for (const conclusion of ["success", "skipped", "neutral", null]) {
      expect(readWorkflowRun(workflow({ conclusion }))).toStrictEqual({
        ok: false,
        skip: "not-red",
      });
    }
  });

  it("skips an event that is not the run completing", () => {
    expect(
      readWorkflowRun(workflow({ action: "requested", conclusion: null }))
    ).toStrictEqual({ ok: false, skip: "not-completed" });
  });

  it("skips a run with no pull request, such as a push or a fork's run", () => {
    expect(readWorkflowRun(workflow({ pullRequests: [] }))).toStrictEqual({
      ok: false,
      skip: "no-pull-request",
    });
  });

  it("skips a run with no head commit", () => {
    expect(readWorkflowRun(workflow({ headSha: null }))).toStrictEqual({
      ok: false,
      skip: "no-head",
    });
  });

  it("anchors to the first pull request and assumes attempt 1 when the payload omits it", () => {
    const verdict = readWorkflowRun(
      workflow({ pullRequests: [9, 7], raw: { id: 1 } })
    );
    expect(verdict.ok && verdict.event.pullRequest).toBe(9);
    expect(verdict.ok && verdict.event.attempt).toBe(1);
  });
});

describe(readCheckRun, () => {
  it("starts on another app's failed check and keeps its summary", () => {
    const verdict = readCheckRun(check());
    expect(verdict).toStrictEqual({
      event: {
        attempt: 1,
        checkName: "GitGuardian Security Checks",
        conclusion: "failure",
        eventId: 120_017_478_747,
        headSha: HEAD,
        kind: "external-check",
        pullRequest: 7,
        summary: "1 secret incident found",
      },
      ok: true,
    });
  });

  it("skips Baymi's own check by app and by name", () => {
    expect(readCheckRun(check({ app: { slug: "baymiai" } }))).toStrictEqual({
      ok: false,
      skip: "own-check",
    });
    expect(
      readCheckRun(
        check({ app: { slug: null }, raw: { name: "Baymi security review" } })
      )
    ).toStrictEqual({ ok: false, skip: "own-check" });
  });

  it("skips an Actions check run, which the workflow run covers", () => {
    expect(
      readCheckRun(check({ app: { slug: "github-actions" } }))
    ).toStrictEqual({ ok: false, skip: "actions-check-run" });
  });

  it("skips what the workflow rules skip: a success, an open check, no pull request", () => {
    expect(readCheckRun(check({ conclusion: "success" }))).toStrictEqual({
      ok: false,
      skip: "not-red",
    });
    expect(
      readCheckRun(check({ action: "created", conclusion: null }))
    ).toStrictEqual({ ok: false, skip: "not-completed" });
    expect(readCheckRun(check({ pullRequests: [] }))).toStrictEqual({
      ok: false,
      skip: "no-pull-request",
    });
  });

  it("falls back to a generic name when the payload has none", () => {
    const verdict = readCheckRun(check({ raw: {} }));
    expect(verdict.ok && verdict.event.checkName).toBe("check");
    expect(verdict.ok && verdict.event.summary).toBeNull();
  });
});
