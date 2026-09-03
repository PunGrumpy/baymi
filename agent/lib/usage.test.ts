import { describe, expect, it } from "vitest";

import { parseUsage, TURN_EVENT, usageDate, usageQuery } from "#lib/usage";

describe("the report date boundary", () => {
  it("accepts a plain calendar date and nothing else", () => {
    expect(usageDate.safeParse("2026-08-21").success).toBeTruthy();
    expect(usageDate.safeParse("2026-08-21T00:00:00Z").success).toBeFalsy();
    expect(usageDate.safeParse("21/08/2026").success).toBeFalsy();
    expect(usageDate.safeParse("' OR 1=1 --").success).toBeFalsy();
  });
});

describe(usageQuery, () => {
  it("bounds the query by the dates it was given", () => {
    const query = usageQuery("2026-08-14", "2026-08-21");
    expect(query).toContain("'2026-08-14 00:00:00'");
    expect(query).toContain("'2026-08-21 00:00:00'");
    expect(query).toContain(`event = '${TURN_EVENT}'`);
  });
});

describe(parseUsage, () => {
  const columns = [
    "day",
    "model",
    "turns",
    "input_tokens",
    "output_tokens",
    "failed_turns",
  ];

  it("names the positional rows PostHog answers with", () => {
    const rows = parseUsage({
      columns,
      results: [["2026-08-17", "bigmodel/glm-5.3", 4, 120_000, 3400, 1]],
    });
    expect(rows).toStrictEqual([
      {
        day: "2026-08-17",
        failedTurns: 1,
        inputTokens: 120_000,
        model: "bigmodel/glm-5.3",
        outputTokens: 3400,
        turns: 4,
      },
    ]);
  });

  it("reads numbers PostHog returned as strings", () => {
    const rows = parseUsage({
      columns,
      results: [["2026-08-17", "m", "4", "120000", "3400", "0"]],
    });
    expect(rows[0]?.turns).toBe(4);
    expect(rows[0]?.inputTokens).toBe(120_000);
  });

  it("returns nothing for a week with no turns", () => {
    expect(parseUsage({ columns, results: [] })).toStrictEqual([]);
  });

  it("refuses a result whose columns it cannot read", () => {
    // Reading by index against a changed query is the failure this catches:
    // it would report someone else's numbers rather than none.
    expect(() => parseUsage({ columns: ["foo"], results: [["bar"]] })).toThrow(
      "cannot read"
    );
  });
});
