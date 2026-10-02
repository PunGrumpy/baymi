import { describe, expect, it } from "vitest";

import { ANTHROPIC_OPTIONS, EFFORT } from "#lib/model";

describe("the model settings", () => {
  it("names the effort the gateway runs, with thinking on", () => {
    expect(EFFORT).toBe("high");
    expect(ANTHROPIC_OPTIONS).toStrictEqual({
      effort: "high",
      thinking: { type: "enabled" },
    });
  });
});
