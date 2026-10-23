import { describe, expect, it } from "vitest";

import {
  ENGLISH_REPLY_SHARE,
  THAI_REPLY_SHARE,
  firstSentence,
  isThaiReply,
  thaiShare,
} from "./language";

const REPOSITORIES =
  "logixlysia, cursor-action, git-bench, baymi, PunGrumpy/baymi, PunGrumpy/web, eslint-plugin, ultracite, thaipass, chat-adapter-line, ai-sdk-factory, eve-extension และ dotfiles";

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

  it("does not count repository names, branches, numbers or issue references", () => {
    expect(
      thaiShare("PunGrumpy/baymi eng-lead/D1-lead-evals #57 cursor-action 2026")
    ).toBe(0);
  });
});

describe(firstSentence, () => {
  it("skips a greeting and stops at the first sentence end", () => {
    expect(
      firstSentence("สวัสดีครับ! I look after your PRs. Ask me.").trim()
    ).toBe("I look after your PRs");
  });

  it("is empty when the reply is only links", () => {
    expect(firstSentence("https://github.com/o/r/pull/1")).toBe("");
  });
});

describe(isThaiReply, () => {
  it("fails an English reply with a Thai greeting", () => {
    const reply =
      "สวัสดีครับ! I look after your open pull requests, chase CI and reviews, and tell you when one needs your merge.";
    expect(isThaiReply(reply)).toBeFalsy();
  });

  it("fails the short English reply the old measure passed at 0.37", () => {
    expect(isThaiReply("สวัสดีครับ! I look after your PRs.")).toBeFalsy();
  });

  it("passes a Thai reply that lists many repository names", () => {
    const reply = `ผมดูแล pull request ที่เปิดอยู่ของคุณใน ${REPOSITORIES} ครับ`;
    expect(isThaiReply(reply)).toBeTruthy();
  });

  it("passes a Thai first sentence with a quoted English error message", () => {
    const reply = [
      "บิลด์ของ PR นี้ล้มเหลวที่ขั้นตอนติดตั้ง ผมยังไม่ได้แก้อะไร",
      "",
      'ข้อความ error คือ "Error: Cannot find module zod imported from src/lib/env.ts while building the application for production"',
    ].join("\n");
    expect(isThaiReply(reply)).toBeTruthy();
  });

  it("fails an English first sentence ahead of a Thai body", () => {
    const reply =
      "Here is what I look after. ผมดูแล pull request ของคุณและตามให้ถึง merge ทุกวันทำการครับ ถ้ามีอะไรต้องให้คุณดูผมจะบอกก่อนเสมอ";
    expect(isThaiReply(reply)).toBeFalsy();
  });

  it("fails an empty reply", () => {
    expect(isThaiReply("")).toBeFalsy();
  });
});
