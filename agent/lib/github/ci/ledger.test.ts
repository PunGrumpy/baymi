import { describe, expect, it } from "vitest";

import { refusedResult } from "#lib/chase/result";
import {
  CHASE_TOOL,
  ciKey,
  createChaseLedger,
  createChaseResultRecord,
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

/** A chase on `repo`'s run `runId`, attempt 1, as the turn's auth carries it. */
const chase = (repo: string, runId: number) => ({
  attempt: 1,
  key: ciKey(
    { owner: "PunGrumpy", repo },
    { attempt: 1, eventId: runId, kind: "workflow-run" }
  ),
});

const rerunCall = (callId: string, repo: string, runId: number) => ({
  callId,
  input: { owner: "PunGrumpy", repo, runId },
  toolName: RERUN_TOOL,
});

describe(createRerunRecord, () => {
  it("remembers the chase whose own rerun call completed", () => {
    const record = createRerunRecord();
    const turn = chase("baymi", 100);
    record.requested("s1", rerunCall("c1", "baymi", 100), turn);
    record.settled("s1", { callId: "c1", status: "completed" });
    expect(record.accepted(turn.key)).toBeTruthy();
  });

  it("keeps two pull requests' first turns apart, though their turn ids and call ids are the same", () => {
    const record = createRerunRecord();
    const first = chase("baymi", 100);
    const second = chase("logixlysia", 200);
    // Both chases are turn_0 of their own session, and a model can number its calls the same way.
    record.requested("s1", rerunCall("functions.rerun:0", "baymi", 100), first);
    record.requested(
      "s2",
      rerunCall("functions.rerun:0", "logixlysia", 200),
      second
    );
    record.settled("s1", { callId: "functions.rerun:0", status: "completed" });
    record.settled("s2", { callId: "functions.rerun:0", status: "rejected" });
    expect(record.accepted(first.key)).toBeTruthy();
    expect(record.accepted(second.key)).toBeFalsy();
  });

  it("is keyed by the attempt too, so attempt 2 of the same run is not taken as rerun", () => {
    const record = createRerunRecord();
    record.requested("s1", rerunCall("c1", "baymi", 100), chase("baymi", 100));
    record.settled("s1", { callId: "c1", status: "completed" });
    expect(
      record.accepted(
        ciKey(
          { owner: "PunGrumpy", repo: "baymi" },
          { attempt: 2, eventId: 100, kind: "workflow-run" }
        )
      )
    ).toBeFalsy();
  });

  it("ignores a rerun that errored or was refused, another tool, and a run the chase is not about", () => {
    const record = createRerunRecord();
    const turn = chase("baymi", 100);
    record.requested("s1", rerunCall("a", "baymi", 100), turn);
    record.settled("s1", { callId: "a", isError: true, status: "completed" });
    record.requested("s1", rerunCall("b", "baymi", 100), turn);
    record.settled("s1", { callId: "b", status: "rejected" });
    record.requested(
      "s1",
      {
        ...rerunCall("c", "baymi", 100),
        toolName: "github__getCiFailureContext",
      },
      turn
    );
    record.settled("s1", { callId: "c", status: "completed" });
    record.requested("s1", rerunCall("d", "baymi", 999), turn);
    record.settled("s1", { callId: "d", status: "completed" });
    record.requested("s1", rerunCall("e", "baymi", 100), null);
    record.settled("s1", { callId: "e", status: "completed" });
    expect(record.accepted(turn.key)).toBeFalsy();
    expect(record.accepted(chase("baymi", 999).key)).toBeFalsy();
  });

  it("forgets the oldest chase past its bound", () => {
    const record = createRerunRecord(1);
    for (const [index, runId] of [100, 101].entries()) {
      const callId = `c${index}`;
      record.requested(
        "s1",
        rerunCall(callId, "baymi", runId),
        chase("baymi", runId)
      );
      record.settled("s1", { callId, status: "completed" });
    }
    expect(record.accepted(chase("baymi", 100).key)).toBeFalsy();
    expect(record.accepted(chase("baymi", 101).key)).toBeTruthy();
  });
});

describe(createChaseResultRecord, () => {
  const output = refusedResult({
    headSha: "h",
    pullRequest: "https://github.com/PunGrumpy/baymi/pull/7",
    reason: "Today's 3 chases are used up.",
  });
  const pushed = {
    ...output,
    branch: "feat/sum",
    commits: ["c1"],
    reason: "Pushed 1 commit to feat/sum.",
    status: "pushed",
  } as const;

  it("keeps what the chase tool answered on each chase", () => {
    const record = createChaseResultRecord();
    record.note(chase("baymi", 100).key, {
      output: structuredClone(output),
      status: "completed",
      toolName: CHASE_TOOL,
    });
    expect(record.result(chase("baymi", 100).key)).toStrictEqual(output);
    expect(record.result(chase("baymi", 101).key)).toBeNull();
  });

  it("keeps two pull requests' chases apart, though both are the first turn of their own session", () => {
    const record = createChaseResultRecord();
    const first = chase("baymi", 100);
    const second = chase("logixlysia", 200);
    record.note(first.key, {
      output: pushed,
      status: "completed",
      toolName: CHASE_TOOL,
    });
    // The second chase never called the tool: it must not read the first
    // one's push and log its own red check as fixed.
    expect(record.result(second.key)).toBeNull();
    record.note(second.key, {
      output,
      status: "completed",
      toolName: CHASE_TOOL,
    });
    expect(record.result(first.key)).toStrictEqual(pushed);
    expect(record.result(second.key)).toStrictEqual(output);
  });

  it("ignores other tools, failed calls, and output that is not a result", () => {
    const record = createChaseResultRecord();
    const other = chase("baymi", 100).key;
    const failed = chase("baymi", 101).key;
    const garbled = chase("baymi", 102).key;
    record.note(other, {
      output,
      status: "completed",
      toolName: "github__rerunWorkflowRun",
    });
    record.note(failed, {
      isError: true,
      output,
      status: "completed",
      toolName: CHASE_TOOL,
    });
    record.note(garbled, {
      output: "pushed",
      status: "completed",
      toolName: CHASE_TOOL,
    });
    expect([other, failed, garbled].map(record.result)).toStrictEqual([
      null,
      null,
      null,
    ]);
  });

  it("forgets the oldest chase past its bound", () => {
    const record = createChaseResultRecord(1);
    record.note(chase("baymi", 100).key, { output, toolName: CHASE_TOOL });
    record.note(chase("baymi", 101).key, { output, toolName: CHASE_TOOL });
    expect(record.result(chase("baymi", 100).key)).toBeNull();
    expect(record.result(chase("baymi", 101).key)).toStrictEqual(output);
  });
});
