import type { GitHubApiMethod, GitHubJsonObject } from "eve/channels/github";

import { MAINTAINER_GITHUB_LOGIN } from "#lib/trust";

/**
 * The label an escalated issue carries.
 *
 * @remarks
 * Namespaced so it reads as this agent's mark rather than as one of the
 * repository's own triage labels, and so a maintainer can filter it out of a
 * board without touching their vocabulary.
 */
export const ESCALATION_LABEL = "baymi:needs-attention";

const ESCALATION_LABEL_COLOR = "b60205";
const ESCALATION_LABEL_DESCRIPTION =
  "An unattended reply to this issue failed; a maintainer needs to look";

/** Which issue an escalation is about. */
export interface EscalationTarget {
  readonly issueNumber: number;
  readonly owner: string;
  readonly repo: string;
}

/** One GitHub call an escalation makes. */
export interface EscalationCall {
  readonly body: GitHubJsonObject;
  readonly method: GitHubApiMethod;
  readonly path: string;
  /**
   * Whether a failure here is expected traffic rather than a problem. True for
   * creating a label that already exists, which is the normal case after the
   * first escalation and answers 422.
   */
  readonly tolerated: boolean;
}

/**
 * The calls that escalate one issue, in the order they must run.
 *
 * @remarks
 * Pure, so the paths and payloads are checkable without a GitHub. The order is
 * the contract: the label has to exist before it can be applied, and the
 * assignment goes last because it is the step that actually reaches a person.
 * Applying a label nobody sees is not an escalation; a notification is.
 *
 * All three are idempotent on GitHub's side, which is what lets `turn.failed`
 * and `session.failed` both call this without coordinating. A label already
 * applied and an assignee already assigned are both no-ops.
 */
export const escalationCalls = (
  target: EscalationTarget
): readonly EscalationCall[] => {
  const issue = `/repos/${target.owner}/${target.repo}/issues/${target.issueNumber}`;
  return [
    {
      body: {
        color: ESCALATION_LABEL_COLOR,
        description: ESCALATION_LABEL_DESCRIPTION,
        name: ESCALATION_LABEL,
      },
      method: "POST",
      path: `/repos/${target.owner}/${target.repo}/labels`,
      tolerated: true,
    },
    {
      body: { labels: [ESCALATION_LABEL] },
      method: "POST",
      path: `${issue}/labels`,
      tolerated: false,
    },
    {
      body: { assignees: [MAINTAINER_GITHUB_LOGIN] },
      method: "POST",
      path: `${issue}/assignees`,
      tolerated: false,
    },
  ];
};

/** The GitHub call this needs, narrowed so a test can supply one. */
export type EscalationRequest = (input: {
  readonly body?: GitHubJsonObject;
  readonly method: GitHubApiMethod;
  readonly path: string;
}) => Promise<void>;

/**
 * Hands a failed unattended triage to the maintainer: label the issue, assign
 * them, post nothing.
 *
 * @remarks
 * This is what a triage failure does instead of an error comment. The turn was
 * started by a stranger's issue and nobody asked for it, so the failure is the
 * agent's problem and not something to put in front of the reporter, who would
 * read a bot stack trace on the issue they just filed. The maintainer's
 * notifications are the right place, and an assignment is the only thing that
 * reaches them without a channel of its own.
 *
 * Every step is attempted even after an earlier one fails, because the steps
 * are worth different amounts: losing the label costs a filter, losing the
 * assignment costs the whole escalation. The paths that failed come back for
 * the caller to log, since a silent escalation that silently did not happen is
 * the failure this function exists to prevent.
 */
export const escalateFailedTriage = async (
  request: EscalationRequest,
  target: EscalationTarget
): Promise<readonly string[]> => {
  const failed: string[] = [];
  for (const { body, method, path, tolerated } of escalationCalls(target)) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- ordered on purpose: the label has to exist before it is applied
      await request({ body, method, path });
    } catch {
      if (!tolerated) {
        failed.push(path);
      }
    }
  }
  return failed;
};
