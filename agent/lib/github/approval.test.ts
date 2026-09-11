import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_WRITES,
  conversationWrite,
  GATED_WRITES,
  gatedWrite,
  UNATTENDED_WRITE_DENIAL,
} from "#lib/github/approval";
import { GITHUB_WRITES } from "#lib/github/tools";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

const reviewer: SessionAuthContext = {
  attributes: {},
  authenticator: "github-webhook",
  principalId: REVIEWER_PRINCIPAL,
  principalType: "service",
};

const maintainer: SessionAuthContext = {
  attributes: {},
  authenticator: "github-webhook",
  principalId: "github:42",
  principalType: "user",
};

describe("write classification", () => {
  it("covers every mounted write exactly once", () => {
    // A write with no policy falls back to an approval card, which an
    // unattended turn cannot answer. This is what keeps the lists honest.
    const classified = new Set<string>([
      ...CONVERSATION_WRITES,
      ...GATED_WRITES,
    ]);
    expect(classified).toStrictEqual(new Set<string>(GITHUB_WRITES));
    expect(CONVERSATION_WRITES.length + GATED_WRITES.length).toBe(
      GITHUB_WRITES.length
    );
  });
});

describe(conversationWrite, () => {
  it("refuses an unattended turn with a reason the model can read", () => {
    expect(conversationWrite(reviewer)).toStrictEqual({
      reason: UNATTENDED_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("runs uncarded for a person", () => {
    expect(conversationWrite(maintainer)).toBe("not-applicable");
  });
});

describe(gatedWrite, () => {
  it("refuses an unattended turn", () => {
    expect(gatedWrite(reviewer)).toStrictEqual({
      reason: UNATTENDED_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("asks a person first", () => {
    expect(gatedWrite(maintainer)).toBe("user-approval");
    expect(gatedWrite(null)).toBe("user-approval");
  });
});
