import { describe, expect, it, vi } from "vitest";

import type { CheckTarget, GitHubRequest } from "#lib/github/checks";
import {
  CHECK_NAME,
  failedOutcome,
  openCheckRun,
  reviewOutcome,
  settleCheckRun,
} from "#lib/github/checks";
import type { ParsedReview, Severity } from "#lib/github/review";

const target: CheckTarget = {
  headSha: "abc123",
  owner: "acme",
  repo: "widgets",
};

const now = new Date("2026-09-20T01:00:00.000Z");

const finding = (severity: Severity, title: string, line: number | null) => ({
  body: "why it matters",
  line,
  path: "src/db/users.ts",
  severity,
  title,
});

const review = (
  findings: ParsedReview["findings"],
  body = "Security review: findings below."
): ParsedReview => ({ body, findings });

describe(reviewOutcome, () => {
  it("passes a review with nothing to raise", () => {
    const outcome = reviewOutcome(
      review([], "Security review: nothing to raise.")
    );
    expect(outcome.conclusion).toBe("success");
    expect(outcome.title).toBe("Nothing to raise");
    expect(outcome.summary).toBe("Security review: nothing to raise.");
  });

  it("counts the findings by severity in the title", () => {
    const outcome = reviewOutcome(
      review([
        finding("high", "SQL built from a request field", 42),
        finding("low", "the error handler leaks a stack", 88),
        finding("high", "a second one", 12),
      ])
    );
    expect(outcome.title).toBe("3 findings (2 high, 1 low)");
  });

  it("says one finding in the singular", () => {
    const outcome = reviewOutcome(
      review([finding("critical", "a committed key", 3)])
    );
    expect(outcome.title).toBe("1 finding (1 critical)");
  });

  it("settles a finding as neutral, never as a failure", () => {
    const outcome = reviewOutcome(
      review([finding("critical", "a committed key", 3)])
    );
    expect(outcome.conclusion).toBe("neutral");
  });

  it("lists each finding with the line it sits on", () => {
    const outcome = reviewOutcome(
      review([finding("high", "SQL built from a request field", 42)])
    );
    expect(outcome.summary).toContain(
      "- **High** · SQL built from a request field — `src/db/users.ts:42`"
    );
  });

  it("names the file alone when the finding has no line", () => {
    const outcome = reviewOutcome(
      review([finding("medium", "a widened workflow permission", null)])
    );
    expect(outcome.summary).toContain("`src/db/users.ts`");
    expect(outcome.summary).not.toContain("src/db/users.ts:");
  });
});

describe(failedOutcome, () => {
  it("fails the check and says the change is unreviewed", () => {
    const outcome = failedOutcome("review_not_a_review");
    expect(outcome.conclusion).toBe("failure");
    expect(outcome.title).toBe("The review did not run");
    expect(outcome.summary).toContain("unreviewed rather than clean");
    expect(outcome.summary).toContain("review_not_a_review");
  });

  it("leaves the code out when there is none", () => {
    expect(failedOutcome().summary).not.toContain("Error code");
  });
});

describe(openCheckRun, () => {
  it("opens the run in progress on the head commit", async () => {
    const request = vi.fn<GitHubRequest>().mockResolvedValue({ body: {} });
    const result = await openCheckRun(request, target, now);
    expect(result).toStrictEqual({ ok: true });
    expect(request).toHaveBeenCalledWith({
      body: {
        head_sha: "abc123",
        name: CHECK_NAME,
        output: expect.objectContaining({ title: "Reviewing" }),
        started_at: "2026-09-20T01:00:00.000Z",
        status: "in_progress",
      },
      method: "POST",
      path: "/repos/acme/widgets/check-runs",
    });
  });

  it("reports a refusal rather than throwing into the dispatch", async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockRejectedValue(new Error("403 Resource not accessible"));
    const result = await openCheckRun(request, target, now);
    expect(result.ok).toBeFalsy();
    expect(result.ok === false && result.error).toContain("403");
  });
});

describe(settleCheckRun, () => {
  const outcome = {
    conclusion: "neutral",
    summary: "one finding",
    title: "1 finding (1 high)",
  } as const;

  it("finds the run by name and completes it", async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce({ body: { check_runs: [{ id: 99 }] } })
      .mockResolvedValueOnce({ body: {} });
    const result = await settleCheckRun(request, target, outcome, now);
    expect(result).toStrictEqual({ ok: true });
    const [lookup] = request.mock.calls[0] ?? [];
    expect(lookup?.path).toContain("/commits/abc123/check-runs?check_name=");
    expect(request).toHaveBeenLastCalledWith({
      body: {
        completed_at: "2026-09-20T01:00:00.000Z",
        conclusion: "neutral",
        output: { summary: "one finding", title: "1 finding (1 high)" },
        status: "completed",
      },
      method: "PATCH",
      path: "/repos/acme/widgets/check-runs/99",
    });
  });

  it("says so when the head commit carries no run of ours", async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValue({ body: { check_runs: [] } });
    const result = await settleCheckRun(request, target, outcome, now);
    expect(result.ok).toBeFalsy();
    expect(request).toHaveBeenCalledOnce();
  });

  it("reports a rejected patch rather than throwing", async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce({ body: { check_runs: [{ id: 99 }] } })
      .mockRejectedValueOnce(new Error("422 Unprocessable"));
    const result = await settleCheckRun(request, target, outcome, now);
    expect(result.ok).toBeFalsy();
    expect(result.ok === false && result.error).toContain("422");
  });
});
