import { describe, expect, it } from "vitest";

import {
  ciKey,
  createChaseLedger,
  createRerunRecord,
  RERUN_TOOL,
} from "#lib/github/ci/ledger";

const repository = { owner: "PunGrumpy", repo: "baymi" };

describe(ciKey, () => {
  it("is the run and its attempt, so a rerun is a new key and a redelivery is not", () => {
    const first = { attempt: 1, eventId: 99, kind: "workflow-run" } as const;
    expect(ciKey(repository, first)).toBe("pungrumpy/baymi#run99@1");
    expect(ciKey(repository, first)).toBe(ciKey(repository, first));
    expect(ciKey(repository, { ...first, attempt: 2 })).not.toBe(
      ciKey(repository, first)
    );
  });

  it("is the check run for an external check, which has no attempt", () => {
    expect(
      ciKey(repository, { attempt: 1, eventId: 5, kind: "external-check" })
    ).toBe("pungrumpy/baymi#check5");
  });

  it("separates repositories that share a run id", () => {
    const event = { attempt: 1, eventId: 1, kind: "workflow-run" } as const;
    expect(ciKey(repository, event)).not.toBe(
      ciKey({ owner: "PunGrumpy", repo: "logixlysia" }, event)
    );
  });
});

describe(createChaseLedger, () => {
  it("lets the first caller start a turn and refuses a redelivery", () => {
    const ledger = createChaseLedger();
    expect(ledger.claimDispatch("a")).toBeTruthy();
    expect(ledger.claimDispatch("a")).toBeFalsy();
    expect(ledger.claimDispatch("b")).toBeTruthy();
  });

  it("keeps starting a turn and saying something apart", () => {
    const ledger = createChaseLedger();
    ledger.claimDispatch("a");
    expect(ledger.claimReport("a")).toBeTruthy();
    expect(ledger.claimReport("a")).toBeFalsy();
  });

  it("forgets the oldest key past its bound", () => {
    const ledger = createChaseLedger(2);
    ledger.claimDispatch("a");
    ledger.claimDispatch("b");
    ledger.claimDispatch("c");
    expect(ledger.claimDispatch("a")).toBeTruthy();
  });
});

describe(createRerunRecord, () => {
  it("remembers a turn whose rerun call completed", () => {
    const record = createRerunRecord();
    record.note("turn-1", { status: "completed", toolName: RERUN_TOOL });
    expect(record.accepted("turn-1")).toBeTruthy();
    expect(record.accepted("turn-2")).toBeFalsy();
  });

  it("ignores a rerun that errored or was refused, and every other tool", () => {
    const record = createRerunRecord();
    record.note("a", {
      isError: true,
      status: "completed",
      toolName: RERUN_TOOL,
    });
    record.note("b", { status: "rejected", toolName: RERUN_TOOL });
    record.note("c", {
      status: "completed",
      toolName: "github__getCiFailureContext",
    });
    expect(["a", "b", "c"].some((turn) => record.accepted(turn))).toBeFalsy();
  });

  it("forgets the oldest turn past its bound", () => {
    const record = createRerunRecord(1);
    record.note("a", { status: "completed", toolName: RERUN_TOOL });
    record.note("b", { status: "completed", toolName: RERUN_TOOL });
    expect(record.accepted("a")).toBeFalsy();
    expect(record.accepted("b")).toBeTruthy();
  });
});
