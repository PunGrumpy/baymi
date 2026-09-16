import { describe, expect, it } from "vitest";

import {
  createGroundingLedger,
  isReviewReply,
  mayPostReview,
} from "#lib/github/grounding";

const toolResult = { kind: "tool-result" };
const skillLoaded = { kind: "load-skill-result" };
const failedTool = { isError: true, kind: "tool-result" };

describe(createGroundingLedger, () => {
  it("treats a turn with no settled action as ungrounded", () => {
    const ledger = createGroundingLedger();
    expect(ledger.isGrounded("turn-1")).toBeFalsy();
  });

  it("grounds a turn on one settled tool call", () => {
    const ledger = createGroundingLedger();
    ledger.note("turn-1", toolResult);
    expect(ledger.isGrounded("turn-1")).toBeTruthy();
  });

  it("does not ground a turn that only loaded the skill", () => {
    const ledger = createGroundingLedger();
    ledger.note("turn-1", skillLoaded);
    expect(ledger.isGrounded("turn-1")).toBeFalsy();
    ledger.note("turn-1", toolResult);
    expect(ledger.isGrounded("turn-1")).toBeTruthy();
  });

  it("does not ground a turn whose only action errored", () => {
    const ledger = createGroundingLedger();
    ledger.note("turn-1", failedTool);
    expect(ledger.isGrounded("turn-1")).toBeFalsy();
  });

  it("grounds a turn that recovered after a failed action", () => {
    const ledger = createGroundingLedger();
    ledger.note("turn-1", failedTool);
    ledger.note("turn-1", toolResult);
    expect(ledger.isGrounded("turn-1")).toBeTruthy();
  });

  it("keeps turns apart", () => {
    const ledger = createGroundingLedger();
    ledger.note("turn-1", toolResult);
    expect(ledger.isGrounded("turn-2")).toBeFalsy();
  });

  it("hands out one report per turn, however often it is asked", () => {
    const ledger = createGroundingLedger();
    expect(ledger.reportOnce("turn-1")).toBeTruthy();
    expect(ledger.reportOnce("turn-1")).toBeFalsy();
    expect(ledger.reportOnce("turn-2")).toBeTruthy();
  });

  it("evicts the oldest turn rather than growing without bound", () => {
    const ledger = createGroundingLedger(2);
    for (const turnId of ["turn-1", "turn-2", "turn-3"]) {
      ledger.note(turnId, toolResult);
    }
    expect(ledger.isGrounded("turn-1")).toBeFalsy();
    expect(ledger.isGrounded("turn-2")).toBeTruthy();
    expect(ledger.isGrounded("turn-3")).toBeTruthy();
  });
});

describe(mayPostReview, () => {
  it("holds back an unattended review that read nothing", () => {
    expect(
      mayPostReview({ grounded: false, step: 0, unattended: true })
    ).toBeFalsy();
  });

  it("posts an unattended review that ran its tools", () => {
    expect(
      mayPostReview({ grounded: true, step: 0, unattended: true })
    ).toBeTruthy();
  });

  it("accepts two advanced steps when the ledger has nothing", () => {
    expect(
      mayPostReview({ grounded: false, step: 2, unattended: true })
    ).toBeTruthy();
  });

  it("holds back a turn whose one step was the skill load", () => {
    expect(
      mayPostReview({ grounded: false, step: 1, unattended: true })
    ).toBeFalsy();
  });

  it("always answers a person who asked, grounded or not", () => {
    for (const grounded of [false, true]) {
      expect(
        mayPostReview({ grounded, step: 0, unattended: false })
      ).toBeTruthy();
    }
  });
});

describe(isReviewReply, () => {
  it("holds back an unattended reply the parser rejected", () => {
    expect(isReviewReply({ parsed: false, unattended: true })).toBeFalsy();
  });

  it("passes a parsed review, and anything a person asked for", () => {
    expect(isReviewReply({ parsed: true, unattended: true })).toBeTruthy();
    expect(isReviewReply({ parsed: false, unattended: false })).toBeTruthy();
  });
});
