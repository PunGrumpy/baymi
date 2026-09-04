import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import type {
  PullRequestInput,
  WriteApprovalContext,
} from "#lib/github/approval";
import {
  assignWrite,
  autonomousLabelDenial,
  AUTONOMOUS_WRITE_DENIAL,
  AUTONOMOUS_WRITES,
  autonomousWrite,
  CONVERSATION_WRITES,
  conversationWrite,
  GATED_WRITES,
  gatedWrite,
  githubWriteApprovals,
  labelWrite,
  pullRequestWrite,
} from "#lib/github/approval";
import { GITHUB_WRITES } from "#lib/github/tools";
import {
  AUTONOMOUS_GITHUB_PRINCIPAL,
  MAINTAINER_GITHUB_LOGIN,
} from "#lib/trust";

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

/**
 * A tool call that named no `draft` at all. The value is read off an object
 * because the formatter drops a trailing bare `undefined`, and this parameter
 * is not optional.
 */
const ABSENT = { input: undefined } satisfies {
  input: PullRequestInput | undefined;
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
  it("opens a draft without a card, whoever asked", () => {
    // The branch already landed through an uncarded `git_push`, and a draft
    // cannot merge. A card here confirms nothing the push did not.
    expect(pullRequestWrite(SCHEDULE, { draft: true })).toBe("not-applicable");
    expect(pullRequestWrite(MAINTAINER, { draft: true })).toBe(
      "not-applicable"
    );
    expect(pullRequestWrite(null, { draft: true })).toBe("not-applicable");
  });

  it("still asks about a pull request that is ready to merge", () => {
    expect(pullRequestWrite(SCHEDULE, { draft: false })).toBe("user-approval");
    expect(pullRequestWrite(SCHEDULE, {})).toBe("user-approval");
    expect(pullRequestWrite(MAINTAINER, { draft: false })).toBe(
      "user-approval"
    );
    expect(pullRequestWrite(MAINTAINER, ABSENT.input)).toBe("user-approval");
  });

  it("reads only a literal true as a draft", () => {
    // `draft` arrives from the model, and the only thing that follows from it
    // is an exemption, so a string is not close enough.
    expect(pullRequestWrite(MAINTAINER, { draft: "true" })).toBe(
      "user-approval"
    );
  });

  it("refuses an unattended turn either way", () => {
    expect(pullRequestWrite(UNATTENDED, { draft: true })).toStrictEqual({
      reason: AUTONOMOUS_WRITE_DENIAL,
      type: "denied",
    });
    expect(pullRequestWrite(UNATTENDED, { draft: false })).toStrictEqual({
      reason: AUTONOMOUS_WRITE_DENIAL,
      type: "denied",
    });
  });
});

describe(assignWrite, () => {
  it("lets an unattended turn hand the issue to the maintainer", () => {
    expect(
      assignWrite(UNATTENDED, { assignees: [MAINTAINER_GITHUB_LOGIN] })
    ).toBe("not-applicable");
  });

  it("matches the login case-insensitively, the way GitHub does", () => {
    expect(assignWrite(UNATTENDED, { assignees: ["PunGrumpy"] })).toBe(
      "not-applicable"
    );
  });

  it("refuses anyone else, alone or alongside the maintainer", () => {
    // Choosing whose week to spend, from a stranger's text, is not a
    // judgement this turn is in a position to make.
    for (const assignees of [
      ["someone-else"],
      [MAINTAINER_GITHUB_LOGIN, "someone-else"],
    ]) {
      expect(assignWrite(UNATTENDED, { assignees })).toMatchObject({
        type: "denied",
      });
    }
  });

  it("refuses an assignment that assigns nobody", () => {
    // It reads as an escalation and performs none, which is the worst of both.
    expect(assignWrite(UNATTENDED, { assignees: [] })).toMatchObject({
      type: "denied",
    });
    expect(assignWrite(UNATTENDED, ABSENT.input)).toMatchObject({
      type: "denied",
    });
    expect(assignWrite(UNATTENDED, { assignees: "pungrumpy" })).toMatchObject({
      type: "denied",
    });
  });

  it("is uncarded on an attended turn, like the rest of placing an issue", () => {
    expect(assignWrite(MAINTAINER, { assignees: ["anyone"] })).toBe(
      "not-applicable"
    );
  });
});

describe(autonomousLabelDenial, () => {
  it("accepts a taxonomy-shaped label", () => {
    expect(
      autonomousLabelDenial({ color: "d73a4a", name: "needs-repro" })
    ).toBeNull();
    expect(
      autonomousLabelDenial({
        color: "D73A4A",
        description: "Waiting on a reproduction",
        name: "needs repro",
      })
    ).toBeNull();
  });

  it("refuses a name that is prose, padded, or multiline", () => {
    // The turn's input is a stranger's issue body; bounding the shape is what
    // stops a sentence from landing in the repository's taxonomy.
    for (const name of [
      "",
      " needs-repro",
      "needs-repro ",
      "see https://example.com for why",
      "needs\nrepro",
      "x".repeat(51),
    ]) {
      expect(autonomousLabelDenial({ color: "d73a4a", name })).toContain(
        "taxonomy-shaped"
      );
    }
  });

  it("requires a six-digit hex color", () => {
    for (const color of ["", "#d73a4a", "red", "d73a4"]) {
      expect(autonomousLabelDenial({ color, name: "needs-repro" })).toContain(
        "hex color"
      );
    }
  });

  it("bounds the description, and allows none at all", () => {
    expect(autonomousLabelDenial({ color: "d73a4a", name: "ok" })).toBeNull();
    expect(
      autonomousLabelDenial({
        color: "d73a4a",
        description: "x".repeat(101),
        name: "ok",
      })
    ).toContain("single-line");
  });
});

describe(labelWrite, () => {
  it("lets an unattended turn grow the taxonomy in shape", () => {
    expect(
      labelWrite(UNATTENDED, { color: "d73a4a", name: "needs-repro" })
    ).toBe("not-applicable");
  });

  it("refuses one that is not, with the reason the model can read", () => {
    expect(
      labelWrite(UNATTENDED, { color: "nope", name: "needs-repro" })
    ).toMatchObject({ type: "denied" });
  });

  it("is uncarded on an attended turn", () => {
    expect(labelWrite(MAINTAINER, ABSENT.input)).toBe("not-applicable");
  });
});

describe(autonomousWrite, () => {
  it("lets an unattended turn place a label", () => {
    expect(autonomousWrite(UNATTENDED)).toBe("not-applicable");
  });

  it("stays uncarded on an attended turn", () => {
    expect(autonomousWrite(MAINTAINER)).toBe("not-applicable");
  });
});

describe(githubWriteApprovals, () => {
  it("gives every mounted write exactly one policy", () => {
    // A write with no policy falls back to the extension's default, which is
    // an approval card, and an unattended turn cannot answer one.
    const names: readonly string[] = [
      ...CONVERSATION_WRITES,
      ...GATED_WRITES,
      ...AUTONOMOUS_WRITES,
      "addAssignees",
      "createLabel",
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
