import { describe, expect, it } from "vitest";

import {
  modelCostPerMTok,
  openRouterPriceUrl,
  parseListedPrice,
  parseUsage,
  TURN_EVENT,
  usageDate,
  usageQuery,
} from "#lib/usage";

describe("MODEL_COST_PER_MTOK", () => {
  it("reads a price pair in dollars per million tokens", () => {
    expect(modelCostPerMTok.parse("0.6,2.2")).toStrictEqual({
      input: 0.6,
      output: 2.2,
    });
    expect(modelCostPerMTok.parse(" 1 , 5 ")).toStrictEqual({
      input: 1,
      output: 5,
    });
  });

  it("refuses anything that is not two numbers", () => {
    // A malformed price is worse than none: it would put a number nobody can
    // trace into a weekly report.
    for (const value of ["0.6", "0.6,", "a,b", "0.6,2.2,3", "$0.6,$2.2", ""]) {
      expect(modelCostPerMTok.safeParse(value).success).toBeFalsy();
    }
  });
});

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

  it("prefers the reported cost and falls back to the estimated one", () => {
    // A deployment with no configured price still returns rows; the cost
    // column is zero rather than absent.
    expect(usageQuery("2026-08-14", "2026-08-21")).toContain(
      "coalesce(properties.`ai.costUsd`, properties.`ai.estimatedCost`, 0)"
    );
  });
});

describe(parseUsage, () => {
  const columns = [
    "day",
    "model",
    "turns",
    "input_tokens",
    "output_tokens",
    "cost_usd",
    "failed_turns",
  ];

  it("names the positional rows PostHog answers with", () => {
    const rows = parseUsage({
      columns,
      results: [["2026-08-17", "bigmodel/glm-5.3", 4, 120_000, 3400, 0.42, 1]],
    });
    expect(rows).toStrictEqual([
      {
        costUsd: 0.42,
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
      results: [["2026-08-17", "m", "4", "120000", "3400", "0.42", "0"]],
    });
    expect(rows[0]?.turns).toBe(4);
    expect(rows[0]?.costUsd).toBe(0.42);
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

describe(openRouterPriceUrl, () => {
  it("asks for one model rather than the whole catalogue", () => {
    // The full listing is a megabyte of every model OpenRouter carries; this
    // one is about a kilobyte, which is what makes checking it weekly sane.
    expect(openRouterPriceUrl("z-ai/glm-5.3")).toBe(
      "https://openrouter.ai/api/v1/models/z-ai/glm-5.3/endpoints"
    );
  });
});

describe(parseListedPrice, () => {
  it("converts dollars per token into dollars per million", () => {
    expect(
      parseListedPrice({
        data: {
          endpoints: [
            {
              pricing: { completion: "0.0000044", prompt: "0.0000014" },
              provider_name: "Z.AI",
            },
          ],
        },
      })
    ).toStrictEqual({ input: 1.4, output: 4.4, provider: "Z.AI" });
  });

  it("keeps the provider with the number", () => {
    // The same model can be served by several providers at several prices,
    // so a rate with no provider attached is not a rate anyone can check.
    const price = parseListedPrice({
      data: {
        endpoints: [
          { pricing: { completion: 2, prompt: 1 }, provider_name: "First" },
          { pricing: { completion: 9, prompt: 9 }, provider_name: "Second" },
        ],
      },
    });
    expect(price?.provider).toBe("First");
  });

  it("has no price for a model nobody lists", () => {
    // A slug that does not exist answers with no endpoints. The report then
    // says the price is unconfirmed rather than quoting the configured one.
    expect(parseListedPrice({ data: { endpoints: [] } })).toBeNull();
    expect(parseListedPrice({})).toBeNull();
    expect(
      parseListedPrice({ data: { endpoints: [{ pricing: {} }] } })
    ).toBeNull();
    expect(
      parseListedPrice({
        data: {
          endpoints: [{ pricing: { completion: "free", prompt: "n/a" } }],
        },
      })
    ).toBeNull();
  });
});
