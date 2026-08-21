import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import type { WriteApprovalContext } from "#lib/github/approval";
import {
  AUTONOMOUS_WRITE_DENIAL,
  CONVERSATION_WRITES,
  conversationWrite,
  GATED_WRITES,
  gatedWrite,
  githubWriteApprovals,
  pullRequestWrite,
} from "#lib/github/approval";
import { GITHUB_WRITES } from "#lib/github/tools";
import { AUTONOMOUS_GITHUB_PRINCIPAL } from "#lib/trust";

const auth = (principalId: string): SessionAuthContext => ({
  attributes: {},
  authenticator: "github-webhook",
  principalId,
  principalType: "user",
});

const UNATTENDED = auth(AUTONOMOUS_GITHUB_PRINCIPAL);
const MAINTAINER = auth("github:12345");
const SCHEDULE: SessionAuthContext = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

const approvalContext = (
  current: SessionAuthContext | null
): WriteApprovalContext => ({ session: { auth: { current } } });

describe(conversationWrite, () => {
  it("lets an attended turn post its reply without a card", () => {
    expect(conversationWrite(MAINTAINER)).toBe("not-applicable");
  });

  it("refuses an unattended turn, which has no one to ask", () => {
    // The prompt would be posted as a comment on the reporter's issue and
    // then wait forever. A refusal the model can read is the better failure.
    expect(conversationWrite(UNATTENDED)).toStrictEqual({
      reason: AUTONOMOUS_WRITE_DENIAL,
      type: "denied",
    });
  });
});

describe(gatedWrite, () => {
  it("asks an attended turn to confirm", () => {
    expect(gatedWrite(MAINTAINER)).toBe("user-approval");
  });

  it("refuses an unattended turn", () => {
    expect(gatedWrite(UNATTENDED)).toStrictEqual({
      reason: AUTONOMOUS_WRITE_DENIAL,
      type: "denied",
    });
  });
});

describe(pullRequestWrite, () => {
  it("lets a scheduled sweep open a draft without a card", () => {
    // Nobody is watching Slack when a sweep fires, so a card there parks the
    // session instead of confirming anything. A draft cannot merge.
    expect(pullRequestWrite(SCHEDULE, { draft: true })).toBe("not-applicable");
  });

  it("still asks a sweep about a pull request that is ready to merge", () => {
    expect(pullRequestWrite(SCHEDULE, { draft: false })).toBe("user-approval");
    expect(pullRequestWrite(SCHEDULE, {})).toBe("user-approval");
  });

  it("asks a person whether the pull request is a draft or not", () => {
    expect(pullRequestWrite(MAINTAINER, { draft: true })).toBe("user-approval");
  });

  it("refuses an unattended turn either way", () => {
    expect(pullRequestWrite(UNATTENDED, { draft: true })).toStrictEqual({
      reason: AUTONOMOUS_WRITE_DENIAL,
      type: "denied",
    });
  });
});

describe(githubWriteApprovals, () => {
  it("gives every mounted write exactly one policy", () => {
    // A write with no policy falls back to the extension's default, which is
    // an approval card, and an unattended turn cannot answer one.
    const names: readonly string[] = [
      ...CONVERSATION_WRITES,
      ...GATED_WRITES,
      "createPullRequest",
    ];
    // No tool classified twice, every mounted write classified once, and the
    // map the extension is handed carrying exactly those keys.
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names)).toStrictEqual(new Set(GITHUB_WRITES));
    expect(new Set(Object.keys(githubWriteApprovals()))).toStrictEqual(
      new Set(GITHUB_WRITES)
    );
  });

  it("reads the decision off the calling session, not the tool name", () => {
    const approvals = githubWriteApprovals();
    const comment = approvals.addPullRequestComment;
    const close = approvals.closeIssue;
    expect(comment?.(approvalContext(MAINTAINER))).toBe("not-applicable");
    expect(close?.(approvalContext(MAINTAINER))).toBe("user-approval");
    expect(comment?.(approvalContext(UNATTENDED))).toStrictEqual({
      reason: AUTONOMOUS_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("treats a session with no resolved auth as attended", () => {
    // A missing principal is not the constructed unattended one, so the
    // fallback is the card rather than a silent refusal.
    expect(githubWriteApprovals().createIssue?.(approvalContext(null))).toBe(
      "user-approval"
    );
  });
});
