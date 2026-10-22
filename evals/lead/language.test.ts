import { describe, expect, it } from "vitest";

import { ENGLISH_REPLY_SHARE, THAI_REPLY_SHARE, thaiShare } from "./language";

describe(thaiShare, () => {
  it("scores a Thai reply with English terms as Thai", () => {
    const reply =
      "https://github.com/PunGrumpy/baymi/pull/54 Baymi security review ยังมี 1 medium finding ไม่ได้ triage แล้วก็ยังไม่มีใครตอบคำถามของคุณเลย";
    expect(thaiShare(reply)).toBeGreaterThanOrEqual(THAI_REPLY_SHARE);
  });

  it("scores an English reply as English, links and code included", () => {
    const reply =
      "I cannot merge from here yet, there is no merge tool mounted today. Which repository is PR #101 in? `PunGrumpy/baymi` https://github.com/PunGrumpy/baymi/pull/54";
    expect(thaiShare(reply)).toBeLessThanOrEqual(ENGLISH_REPLY_SHARE);
  });

  it("does not count Thai inside a link or a code span", () => {
    expect(thaiShare("https://example.com/ไทย `ไทย`")).toBe(0);
  });

  it("scores a reply with no letters as zero", () => {
    expect(thaiShare("")).toBe(0);
  });
});
