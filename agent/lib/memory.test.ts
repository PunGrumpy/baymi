import { describe, expect, it } from "vitest";

import { hasMemoryStore } from "#lib/memory";

describe(hasMemoryStore, () => {
  it("always has a store off Vercel, where eve dev keeps it in process", () => {
    expect(hasMemoryStore({})).toBeTruthy();
  });

  it("needs Blob credentials on a deployment", () => {
    expect(hasMemoryStore({ VERCEL: "1" })).toBeFalsy();
    expect(
      hasMemoryStore({ EVE_MEMORY_BLOB_STORE_ID: "store_1", VERCEL: "1" })
    ).toBeTruthy();
    expect(
      hasMemoryStore({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw", VERCEL: "1" })
    ).toBeTruthy();
  });

  it("treats a blank value as absent, the way fileMemory does", () => {
    expect(
      hasMemoryStore({ EVE_MEMORY_BLOB_STORE_ID: "  ", VERCEL: "1" })
    ).toBeFalsy();
  });
});
