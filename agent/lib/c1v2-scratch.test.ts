import { describe, expect, it } from "vitest";

import { double, half } from "#lib/c1v2-scratch";

describe(half, () => {
  it("halves a number", () => {
    expect(half(8)).toBe(4);
  });
});

describe(double, () => {
  it("doubles a number", () => {
    expect(double(5)).toBe(10);
  });
});
