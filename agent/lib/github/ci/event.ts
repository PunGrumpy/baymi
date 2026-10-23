import type {
  GitHubCheckRunEvent,
  GitHubWorkflowRunEvent,
} from "eve/channels/github";
import { z } from "zod";

import { CHECK_NAME } from "#lib/github/checks";
import { BOT_NAME } from "#lib/github/comments";

/**
 * Which CI webhooks start a chase, decided from the event alone.
 *
 * @remarks
 * Two events carry a red check and they cover different ground. A
 * `workflow_run` is a GitHub Actions run that has finished: every job has
 * settled, the logs are complete, and the run can be rerun, so it is the one
 * event the Actions chase waits for. A `check_run` from Actions fires per
 * job while the run is still going, would start one turn per failed job, and
 * names a run the rerun guard refuses until it ends, so it is skipped and the
 * `workflow_run` that follows covers it. A `check_run` from any other app
 * (GitGuardian, a coverage service) has no log to read and no run to rerun;
 * it is the other kind of red check, and the chase reports it as such.
 *
 * Nothing here reads the pull request. Whether the pull request is open, is
 * not a draft, is the maintainer's and still sits on this commit takes a read
 * of it, and `./pull-request.ts` decides that.
 */

/** The app GitHub Actions' check runs and workflow runs come from. */
const ACTIONS_APP = "github-actions";

/** Ended badly enough to look at. `cancelled` is admitted by the chase only when the log shows a timeout. */
const RED_CONCLUSIONS: ReadonlySet<string> = new Set([
  "cancelled",
  "failure",
  "timed_out",
]);

/** Whether a conclusion is one the chase looks at; GitHub's answer for a run, read again later, is checked against this. */
export const isRedConclusion = (conclusion: string | null): boolean =>
  conclusion !== null && RED_CONCLUSIONS.has(conclusion);

/** The two kinds of red check the chase tells apart. */
export type CiKind = "external-check" | "workflow-run";

/** A red check that passed the event rules. */
export interface RedEvent {
  /** The workflow run's attempt when the event fired; 1 for an external check. */
  readonly attempt: number;
  /** The external check's name, or the workflow's. */
  readonly checkName: string;
  readonly conclusion: string;
  /** The workflow run's id or the check run's id. */
  readonly eventId: number;
  readonly headSha: string;
  readonly kind: CiKind;
  /** The first pull request the event names. */
  readonly pullRequest: number;
  /** An external check's own one-line summary, when it gave one. */
  readonly summary: string | null;
}

/** Why an event started nothing. Logged, never shown. */
export type EventSkip =
  | "actions-check-run"
  | "no-head"
  | "no-pull-request"
  | "not-completed"
  | "not-red"
  | "own-check";

export type EventVerdict =
  | { readonly event: RedEvent; readonly ok: true }
  | { readonly ok: false; readonly skip: EventSkip };

/** `raw` is the `workflow_run` object, not the envelope; see `docs/notes.md`. */
const WORKFLOW_RAW = z.looseObject({
  name: z.string().nullish(),
  run_attempt: z.number().int().positive().nullish(),
});

const CHECK_RAW = z.looseObject({
  name: z.string().nullish(),
  output: z
    .looseObject({
      summary: z.string().nullish(),
      title: z.string().nullish(),
    })
    .nullish(),
});

/** The rules every CI event shares, ahead of the ones for its kind. */
const commonRules = (
  payload: Pick<
    GitHubCheckRunEvent,
    "action" | "conclusion" | "headSha" | "pullRequests"
  >
):
  | {
      readonly headSha: string;
      readonly ok: true;
      readonly pullRequest: number;
    }
  | { readonly ok: false; readonly skip: EventSkip } => {
  if (payload.action !== "completed") {
    return { ok: false, skip: "not-completed" };
  }
  if (payload.conclusion === null || !RED_CONCLUSIONS.has(payload.conclusion)) {
    return { ok: false, skip: "not-red" };
  }
  const [pullRequest] = payload.pullRequests;
  if (pullRequest === undefined) {
    return { ok: false, skip: "no-pull-request" };
  }
  if (payload.headSha === null) {
    return { ok: false, skip: "no-head" };
  }
  return { headSha: payload.headSha, ok: true, pullRequest };
};

const summaryOf = (
  output: { title?: string | null; summary?: string | null } | null | undefined
): string | null => {
  const text = output?.summary ?? output?.title ?? null;
  return text === null || text.trim() === "" ? null : text.trim();
};

/** A workflow run that finished red. */
export const readWorkflowRun = (
  event: GitHubWorkflowRunEvent
): EventVerdict => {
  const common = commonRules(event);
  if (!common.ok) {
    return common;
  }
  const raw = WORKFLOW_RAW.safeParse(event.raw);
  return {
    event: {
      attempt: (raw.success ? raw.data.run_attempt : null) ?? 1,
      checkName: (raw.success ? raw.data.name : null) ?? "workflow",
      conclusion: event.conclusion ?? "failure",
      eventId: event.workflowRunId,
      headSha: common.headSha,
      kind: "workflow-run",
      pullRequest: common.pullRequest,
      summary: null,
    },
    ok: true,
  };
};

/**
 * A check run that finished red and is not Actions' (see the note above) and
 * not Baymi's own review, which is red when a review died and is already
 * reported to Slack by the channel.
 */
export const readCheckRun = (event: GitHubCheckRunEvent): EventVerdict => {
  const common = commonRules(event);
  if (!common.ok) {
    return common;
  }
  if (event.app.slug === ACTIONS_APP) {
    return { ok: false, skip: "actions-check-run" };
  }
  const raw = CHECK_RAW.safeParse(event.raw);
  const name = (raw.success ? raw.data.name : null) ?? "check";
  if (event.app.slug === BOT_NAME || name === CHECK_NAME) {
    return { ok: false, skip: "own-check" };
  }
  return {
    event: {
      attempt: 1,
      checkName: name,
      conclusion: event.conclusion ?? "failure",
      eventId: event.checkRunId,
      headSha: common.headSha,
      kind: "external-check",
      pullRequest: common.pullRequest,
      summary: raw.success ? summaryOf(raw.data.output) : null,
    },
    ok: true,
  };
};
