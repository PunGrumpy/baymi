import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

import type { CiAssessment } from "#lib/github/ci/assess";
import type { FailureKind, FailureReason } from "#lib/github/ci/classify";
import { decideRerun } from "#lib/github/ci/decide";
import { CHASE_TOOL } from "#lib/github/ci/ledger";
import { APP_PRINCIPAL } from "#lib/trust";

/**
 * What a chase turn carries from the webhook to the end of the turn.
 *
 * @remarks
 * The hook decides everything it can before the turn starts, and the channel
 * needs those decisions again when the turn ends, to work out whether to
 * speak. The channel keeps no state of its own across the two, and the
 * model's account of what it saw is the one thing the Slack line must not
 * depend on, so the facts travel in the session's auth `attributes`: set by
 * the hook from the signed webhook and what GitHub answered, read back by the
 * channel, and out of the model's reach. They are strings, because that is
 * what `attributes` holds.
 *
 * The evidence line is text from a log. It is kept as data and rendered
 * through `./line.ts`; the model sees it in its brief, quoted.
 */

const KINDS = [
  "external",
  "flake",
  "own-code",
  "stale-base",
  "unknown",
] as const satisfies readonly FailureKind[];

const REASONS = [
  "base-unread",
  "breaks-caller",
  "external-check",
  "in-diff",
  "network",
  "no-file",
  "no-log",
  "outside-diff",
  "runner",
  "timeout",
] as const satisfies readonly FailureReason[];

const POSITIVE_INTEGER = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number);

const CI_ATTRIBUTES = z.object({
  ci_attempt: POSITIVE_INTEGER,
  ci_conclusion: z.string().min(1),
  ci_evidence: z.string(),
  ci_head: z.string().min(1),
  ci_job: z.string().min(1),
  ci_key: z.string().min(1),
  ci_kind: z.enum(KINDS),
  ci_reason: z.enum(REASONS),
  ci_run: z.union([POSITIVE_INTEGER, z.literal("")]),
});

/** Everything the end of the turn needs. */
export interface CiTurn {
  readonly attempt: number;
  readonly conclusion: string;
  readonly evidence: string;
  readonly headSha: string;
  readonly job: string;
  readonly key: string;
  readonly kind: FailureKind;
  readonly reason: FailureReason;
  /** `null` for an external check. */
  readonly runId: number | null;
}

export const ciTurn = (assessment: CiAssessment, key: string): CiTurn => ({
  attempt: assessment.attempt,
  conclusion: assessment.conclusion,
  evidence: assessment.classification.line ?? "",
  headSha: assessment.headSha,
  job: assessment.jobName,
  key,
  kind: assessment.classification.kind,
  reason: assessment.classification.reason,
  runId: assessment.runId,
});

/** The attributes the turn's auth carries. */
export const encodeCiTurn = (turn: CiTurn) => ({
  ci_attempt: String(turn.attempt),
  ci_conclusion: turn.conclusion,
  ci_evidence: turn.evidence,
  ci_head: turn.headSha,
  ci_job: turn.job,
  ci_key: turn.key,
  ci_kind: turn.kind,
  ci_reason: turn.reason,
  ci_run: turn.runId === null ? "" : String(turn.runId),
});

/** The turn an auth carries, or `null` when it is not a chase (a schedule, say). */
export const readCiTurn = (auth: SessionAuthContext | null): CiTurn | null => {
  const parsed = CI_ATTRIBUTES.safeParse(auth?.attributes);
  if (!parsed.success) {
    return null;
  }
  const attributes = parsed.data;
  return {
    attempt: attributes.ci_attempt,
    conclusion: attributes.ci_conclusion,
    evidence: attributes.ci_evidence,
    headSha: attributes.ci_head,
    job: attributes.ci_job,
    key: attributes.ci_key,
    kind: attributes.ci_kind,
    reason: attributes.ci_reason,
    runId: attributes.ci_run === "" ? null : attributes.ci_run,
  };
};

/**
 * The auth a chase turn runs under: the app's own principal, anchored to the
 * pull request by the attributes the channel stamped from the webhook.
 *
 * @remarks
 * Shaped exactly like the principal eve gives a schedule (`docs/notes.md`),
 * which is what `classifyPrincipal` recognizes as `app`: unattended, no
 * memory write, no GitHub write that needs a person. The
 * sender's login and type are dropped: for a CI event the sender is whoever
 * pushed, and nothing here is on their authority.
 */
export const chaseAuth = (
  base: SessionAuthContext,
  turn: CiTurn
): SessionAuthContext => {
  const { user_login: _login, user_type: _type, ...anchors } = base.attributes;
  return {
    attributes: { ...anchors, ...encodeCiTurn(turn) },
    authenticator: "app",
    principalId: APP_PRINCIPAL,
    principalType: "runtime",
  };
};

const QUOTE_MAX = 160;

/** What a reason means that its name does not say, for the two a model could misread. */
const REASON_NOTES: Partial<Record<FailureReason, string>> = {
  "breaks-caller":
    " The failing file is outside the diff and the base branch passes, so the diff changed something that file depends on.",
  "outside-diff":
    " The base branch fails the same job, so the diff did not cause it.",
};

/**
 * What the model is told, as context ahead of the turn.
 *
 * @remarks
 * It states the decision already made rather than asking for one: the
 * classification is code's, and the model's part is the rerun, which goes
 * through the approval policy and the guard. The last paragraph is the
 * boundary this turn runs inside, repeated because the GitHub channel's
 * fragment tells every turn on it that its reply is the comment.
 */
export const chaseBrief = (
  turn: CiTurn,
  pullRequest?: { readonly number: number; readonly repository: string }
): readonly string[] => {
  const rerun = decideRerun({
    attempt: turn.attempt,
    classification: { kind: turn.kind },
    conclusion: turn.conclusion,
  });
  const evidence =
    turn.evidence === "" ? "none" : `"${turn.evidence.slice(0, QUOTE_MAX)}"`;
  const action =
    turn.runId !== null && rerun.rerun
      ? `Call \`github__rerunWorkflowRun\` once for run ${turn.runId} of this repository, and do not call it again whatever it answers. The tool refuses anything but the first rerun of a failed run on the current head.`
      : "Do not rerun anything. The failure is not one a rerun fixes, or it has been rerun already.";
  return [
    [
      "# CI chase",
      "A check on this pull request finished red, and the app started this turn on its own. Nobody asked you anything and nobody is reading your reply.",
      `- Check: ${turn.job}${turn.runId === null ? "" : `, workflow run ${turn.runId}`}, attempt ${turn.attempt}, ended ${turn.conclusion}, head ${turn.headSha.slice(0, 7)}.`,
      `- Classified by code as: ${turn.kind} (${turn.reason}). Evidence: ${evidence}${REASON_NOTES[turn.reason] ?? ""}`,
      `- ${action}`,
      ...(turn.kind === "own-code" && pullRequest !== undefined
        ? [
            `- The diff's own code failed. Call \`${CHASE_TOOL}\` once with repository \`${pullRequest.repository}\`, pullRequest ${pullRequest.number}, and failure ${evidence === "none" ? `"${turn.job}"` : `"${turn.job}: ${turn.evidence.slice(0, QUOTE_MAX).replaceAll('"', "'")}"`}. It reproduces the failure in its own sandbox, fixes it, and pushes; whatever it answers, do not call it again.`,
          ]
        : []),
      "- The channel reads GitHub after you finish and tells PunGrumpy on Slack, in Thai, only when the pull request is blocked on them. You write nothing to Slack and nothing to the pull request.",
      "- Do not comment on the pull request, reply in its thread, open an issue, or ask a question. Your final message is discarded; keep it to one line saying what you did.",
    ].join("\n"),
  ];
};
