import type {
  AssertionResult,
  EveEvalResult,
  EveEvalRunSummary,
} from "eve/evals";
import { describe, expect, it } from "vitest";

import {
  EVAL_EVENT,
  evalEvents,
  failedAssertions,
  softScore,
  suiteOf,
} from "#evals/lib/posthog";

const assertion = (
  overrides: Partial<AssertionResult> & Pick<AssertionResult, "name">
): AssertionResult => ({
  passed: true,
  score: 1,
  severity: "gate",
  ...overrides,
});

// SAFETY: `EveEvalResult` also carries `result` (the full task transcript) and
// the optional error and skip fields. Nothing under test reads them, so the
// fixture fills only the five the reporter projects and asserts the cast rather
// than building a transcript that no assertion would look at.
const result = (overrides: Partial<EveEvalResult>): EveEvalResult =>
  ({
    assertions: [],
    completedAt: "2026-08-22T00:00:10.000Z",
    id: "style/no-em-dash",
    startedAt: "2026-08-22T00:00:00.000Z",
    verdict: "passed",
    ...overrides,
  }) as EveEvalResult;

// SAFETY: same reasoning. The summary's `target` and its passed/failed/scored
// counters exist for the console reporter; `evalEvents` reads `results` and
// `startedAt` only.
const summary = (results: readonly EveEvalResult[]): EveEvalRunSummary =>
  ({
    completedAt: "2026-08-22T00:05:00.000Z",
    results,
    startedAt: "2026-08-22T00:00:00.000Z",
  }) as EveEvalRunSummary;

const META = {
  judgeModel: "anthropic/claude-opus-5",
  model: "bigmodel/glm-5.3",
} as const;

describe(suiteOf, () => {
  it("takes the suite from the directory the eval lives in", () => {
    expect(suiteOf("style/no-em-dash")).toBe("style");
    expect(suiteOf("skills/triaging-issues")).toBe("skills");
  });

  it("calls an eval at the root of evals/ root rather than itself", () => {
    // Without this, a top-level eval would report its own name as a suite and
    // every such eval would look like a suite of one.
    expect(suiteOf("smoke")).toBe("root");
  });

  it("keeps the first segment when a file exports an array of evals", () => {
    // Array exports derive `<file-id>/<index>`, so the suite is still the
    // directory and not the index.
    expect(suiteOf("skills/writing-quality/0000")).toBe("skills");
  });
});

describe(softScore, () => {
  it("averages the judged assertions and leaves the gates out", () => {
    // The gate scores 1 and would pull the average up to 0.8 if counted.
    expect(
      softScore([
        assertion({ name: "succeeded" }),
        assertion({ name: "judge.closedQA", score: 0.6, severity: "soft" }),
        assertion({ name: "judge.factuality", score: 0.8, severity: "soft" }),
      ])
    ).toBe(0.7);
  });

  it("reports nothing rather than zero when no judge ran", () => {
    // A zero here would read as a bad answer instead of an unasked question,
    // and would drag the suite average down with it.
    expect(softScore([assertion({ name: "succeeded" })])).toBeUndefined();
    expect(softScore([])).toBeUndefined();
  });
});

describe(failedAssertions, () => {
  it("names what failed and carries no judge prose with it", () => {
    const failed = failedAssertions([
      assertion({ name: "succeeded" }),
      assertion({
        message: "The reply quoted the injected instruction verbatim.",
        name: "notCalledTool",
        passed: false,
        score: 0,
      }),
    ]);
    expect(failed).toStrictEqual(["notCalledTool"]);
    expect(JSON.stringify(failed)).not.toContain("injected");
  });
});

describe(evalEvents, () => {
  it("records one event per eval, grouped by the run that produced it", () => {
    const events = evalEvents(
      summary([
        result({ id: "style/no-em-dash" }),
        result({ id: "safety/ignores-injected-instructions" }),
      ]),
      META
    );
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.event).toBe(EVAL_EVENT);
      // The run's start time is already unique and sortable, so it needs no
      // clock or random source of its own.
      expect(event.properties["eval.runId"]).toBe("2026-08-22T00:00:00.000Z");
      expect(event.distinct_id).toBe(META.model);
    }
    expect(events.map((event) => event.properties["eval.suite"])).toStrictEqual(
      ["style", "safety"]
    );
  });

  it("counts the gates separately from the judged score", () => {
    const [event] = evalEvents(
      summary([
        result({
          assertions: [
            assertion({ name: "succeeded" }),
            assertion({ name: "notCalledTool", passed: false, score: 0 }),
            assertion({
              name: "judge.closedQA",
              score: 0.5,
              severity: "soft",
            }),
          ],
          verdict: "failed",
        }),
      ]),
      META
    );
    expect(event?.properties).toMatchObject({
      "eval.assertions": 3,
      "eval.failed": ["notCalledTool"],
      "eval.gates": 2,
      "eval.gatesFailed": 1,
      "eval.softScore": 0.5,
      "eval.verdict": "failed",
    });
  });

  it("times the eval from its own start and end, not the run's", () => {
    const [event] = evalEvents(
      summary([
        result({
          completedAt: "2026-08-22T00:00:12.500Z",
          startedAt: "2026-08-22T00:00:10.000Z",
        }),
      ]),
      META
    );
    expect(event?.properties["eval.durationMs"]).toBe(2500);
    expect(event?.timestamp).toBe("2026-08-22T00:00:12.500Z");
  });

  it("leaves the score key out when nothing was judged", () => {
    const [event] = evalEvents(
      summary([result({ assertions: [assertion({ name: "succeeded" })] })]),
      META
    );
    expect(event?.properties).not.toHaveProperty("eval.softScore");
  });

  it("carries a commit only when the run was given one", () => {
    const [tagged] = evalEvents(summary([result({})]), {
      ...META,
      commitHash: "0857cd1",
    });
    expect(tagged?.properties.commitHash).toBe("0857cd1");
    const [plain] = evalEvents(summary([result({})]), META);
    expect(plain?.properties).not.toHaveProperty("commitHash");
  });
});
