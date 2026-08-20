import type { GitHubIssueEvent } from "eve/channels/github";

import { isTrustedGitHubAssociation } from "#lib/trust";

/**
 * Whether a newly opened issue should start an unattended triage turn.
 *
 * @remarks
 * This is the only dispatch the agent makes that nobody asked for, so the
 * question is narrow on purpose: is this an issue from someone outside the
 * repository, who has no other way to get an answer?
 *
 * Three kinds of author are excluded. The agent's own issues and other bots'
 * would put it in a loop with itself. Anyone the repository already trusts is
 * excluded too, and that one is easy to read as backwards: a maintainer opening
 * an issue is writing a note to themselves, and if they wanted the agent they
 * would mention it, which is a different door with a different gate.
 */
export const shouldTriageIssue = (
  issue: Pick<GitHubIssueEvent, "action" | "raw">,
  senderLogin: string,
  botName: string
): boolean => {
  if (issue.action !== "opened") {
    return false;
  }
  const login = senderLogin.toLowerCase();
  if (login === botName.toLowerCase() || login.endsWith("[bot]")) {
    return false;
  }
  return !isTrustedGitHubAssociation(issue.raw.author_association);
};

/**
 * Whether this GitHub session is an unattended triage run, judged from channel
 * state rather than from who is calling.
 *
 * @remarks
 * `session.failed` runs outside session context and receives no auth, so
 * `isAutonomous` is unavailable exactly where it matters most. The shape of the
 * state answers instead: a triage session is the only GitHub dispatch that
 * starts from an issue rather than from a comment, so it is the only one with
 * an issue number and no triggering comment behind it.
 */
export const isAutonomousTriageState = (state: {
  readonly issueNumber: number | null;
  readonly triggeringCommentId: number | null;
}): boolean => state.issueNumber !== null && state.triggeringCommentId === null;
