import { describe, expect, it } from "vitest";

import { sum } from "#lib/c1-scratch";

describe(sum, () => {
  it("adds both operands", () => {
    expect(sum(2, 3)).toBe(5);
  });
});
