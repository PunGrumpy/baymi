import { describe, expect, it } from "vitest";

import { half } from "#lib/c1v2-scratch";

describe(half, () => {
  it("halves a number", () => {
    expect(half(8)).toBe(4);
  });
});
