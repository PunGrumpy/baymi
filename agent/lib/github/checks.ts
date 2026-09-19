import type { GitHubJsonObject } from "eve/channels/github";
import { z } from "zod";

import type { ParsedReview, ReviewFinding } from "#lib/github/review";
import { SEVERITIES, severityLabel } from "#lib/github/review";

/**
 * The check run on the pull request: in progress while the review runs, and a
 * verdict when it is over.
 *
 * @remarks
 * It is the only thing that appears at all when the review dies, since a
 * failed review posts nothing in the timeline and goes to Slack instead
 * (`agent/channels/github.ts`). Without it the author cannot tell a change
 * nobody read from a clean one.
 *
 * None of this is a tool, for the same reason the review is submitted with a
 * fixed `COMMENT` event: a model that could name its own conclusion could
 * mark its own review green.
 */

/** Stable, because `settleCheckRun` finds the run by it. */
export const CHECK_NAME = "Baymi security review";

export type CheckConclusion = "failure" | "neutral" | "success";

export interface CheckOutcome {
  readonly conclusion: CheckConclusion;
  readonly summary: string;
  readonly title: string;
}

/** The one call this needs, narrowed so a test can supply one. */
export type GitHubRequest = (input: {
  readonly body?: GitHubJsonObject;
  readonly method: "GET" | "PATCH" | "POST";
  readonly path: string;
}) => Promise<{ readonly body: unknown }>;

export interface CheckTarget {
  readonly headSha: string;
  readonly owner: string;
  readonly repo: string;
}

export type CheckResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false };

const CHECK_RUNS = z.object({
  check_runs: z.array(z.object({ id: z.number().int() })),
});

const findingCount = (count: number): string =>
  count === 1 ? "1 finding" : `${count} findings`;

/** Ordered by the severity scale rather than by the findings. */
const severityBreakdown = (
  findings: readonly Pick<ReviewFinding, "severity">[]
): string =>
  SEVERITIES.flatMap((severity) => {
    const count = findings.filter(
      (finding) => finding.severity === severity
    ).length;
    return count === 0 ? [] : [`${count} ${severity}`];
  }).join(", ");

const findingLines = (review: ParsedReview): readonly string[] =>
  review.findings.map((finding) => {
    const location =
      finding.line === null
        ? `\`${finding.path}\``
        : `\`${finding.path}:${finding.line}\``;
    return `- **${severityLabel(finding.severity)}** · ${finding.title} — ${location}`;
  });

/**
 * Findings settle `neutral` rather than `failure`: Baymi never blocks a merge,
 * and a red cross beside one low-severity note would say it does. The severity
 * is in the title, and the reasoning is in the inline comment.
 */
export const reviewOutcome = (review: ParsedReview): CheckOutcome => {
  if (review.findings.length === 0) {
    return {
      conclusion: "success",
      summary: review.body.trim() || "The change raised nothing.",
      title: "Nothing to raise",
    };
  }
  return {
    conclusion: "neutral",
    summary: [
      "Each finding is an inline comment on the line it is about.",
      "",
      ...findingLines(review),
    ].join("\n"),
    title: `${findingCount(review.findings.length)} (${severityBreakdown(review.findings)})`,
  };
};

/**
 * `failure` where a finding gets `neutral`, because this is the agent
 * malfunctioning rather than the change being at fault, and it is the only
 * notice the author gets: the Slack card goes to the maintainer.
 */
export const failedOutcome = (code?: string): CheckOutcome => {
  const lines = [
    "Nothing was posted on this pull request, so treat it as unreviewed rather than clean.",
  ];
  if (code !== undefined) {
    lines.push("", `Error code: \`${code}\``);
  }
  return {
    conclusion: "failure",
    summary: lines.join("\n"),
    title: "The review did not run",
  };
};

export const openCheckRun = async (input: {
  readonly now?: Date;
  readonly request: GitHubRequest;
  readonly target: CheckTarget;
}): Promise<CheckResult> => {
  const { now = new Date(), request, target } = input;
  try {
    await request({
      body: {
        head_sha: target.headSha,
        name: CHECK_NAME,
        output: {
          summary: "Reading the diff and the code around it.",
          title: "Reviewing",
        },
        started_at: now.toISOString(),
        status: "in_progress",
      },
      method: "POST",
      path: `/repos/${target.owner}/${target.repo}/check-runs`,
    });
    return { ok: true };
  } catch (error) {
    return { error: `check run not opened: ${String(error)}`, ok: false };
  }
};

/**
 * The run is found by name rather than carried from the dispatch that opened
 * it: `GitHubChannelState` has no field to put an id in, and the two events
 * can land in different invocations, so a value held in this runtime would be
 * gone exactly when the review took long enough to need it.
 */
export const settleCheckRun = async (input: {
  readonly now?: Date;
  readonly outcome: CheckOutcome;
  readonly request: GitHubRequest;
  readonly target: CheckTarget;
}): Promise<CheckResult> => {
  const { now = new Date(), outcome, request, target } = input;
  try {
    const { body } = await request({
      method: "GET",
      path: `/repos/${target.owner}/${target.repo}/commits/${target.headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&per_page=1`,
    });
    const [run] = CHECK_RUNS.parse(body).check_runs;
    if (run === undefined) {
      return { error: "no check run on the head commit to settle", ok: false };
    }
    await request({
      body: {
        completed_at: now.toISOString(),
        conclusion: outcome.conclusion,
        output: { summary: outcome.summary, title: outcome.title },
        status: "completed",
      },
      method: "PATCH",
      path: `/repos/${target.owner}/${target.repo}/check-runs/${run.id}`,
    });
    return { ok: true };
  } catch (error) {
    return { error: `check run not settled: ${String(error)}`, ok: false };
  }
};
