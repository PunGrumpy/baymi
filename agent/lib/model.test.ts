import { describe, expect, it } from "vitest";

import { MODEL } from "#lib/model";

describe(MODEL, () => {
  it("is a gateway id, so eve routes it through AI Gateway", () => {
    expect(MODEL).toBe("moonshotai/kimi-k2.7-code");
  });
});
