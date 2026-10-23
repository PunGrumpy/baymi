import { describe, expect, it } from "vitest";

import { triple } from "#lib/c1-verify-scratch";

describe(triple, () => {
  it("triples a number", () => expect(triple(3)).toBe(9));
});
