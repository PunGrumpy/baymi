import { describe, expect, it } from "vitest";

import type { SpeakReason } from "#lib/github/ci/decide";
import {
  chaseFailedMessage,
  ciLine,
  ciSlackMessage,
} from "#lib/github/ci/line";
import type { CiLineInput } from "#lib/github/ci/line";

const pullRequest = {
  number: 7,
  repository: "PunGrumpy/baymi",
  url: "https://github.com/PunGrumpy/baymi/pull/7",
};

const input = (overrides: Partial<CiLineInput> = {}): CiLineInput => ({
  attempt: 1,
  evidence: "AssertionError: expected 'a' to equal 'b'",
  job: "Typecheck, lint, test",
  pullRequest,
  reason: "own-code",
  ...overrides,
});

describe(ciLine, () => {
  it("leads with the pull request link, then the classification, the job and the failing line", () => {
    expect(ciLine(input())).toBe(
      "https://github.com/PunGrumpy/baymi/pull/7 CI ล้มจากโค้ดใน PR เอง (Typecheck, lint, test): `AssertionError: expected 'a' to equal 'b'`"
    );
  });

  it("says what each outcome is in its own words", () => {
    const reasons: readonly SpeakReason[] = [
      "cannot-rerun",
      "external-check",
      "own-code",
      "rerun-not-done",
      "second-failure",
      "stale-base",
      "unclassified",
    ];
    const lines = reasons.map((reason) => ciLine(input({ reason })));
    expect(new Set(lines).size).toBe(lines.length);
    expect(ciLine(input({ reason: "stale-base" }))).toContain("rebase");
    expect(ciLine(input({ reason: "second-failure" }))).toContain("ไม่ใช่ flake");
  });

  it("leaves out the evidence when there is none", () => {
    expect(ciLine(input({ evidence: null }))).toBe(
      "https://github.com/PunGrumpy/baymi/pull/7 CI ล้มจากโค้ดใน PR เอง (Typecheck, lint, test)"
    );
  });

  it("neutralizes what Slack would act on in a log line", () => {
    const line = ciLine(
      input({ evidence: "<!channel> `x` <https://evil.example|click> & done" })
    );
    expect(line).not.toContain("<!channel>");
    expect(line).not.toContain("<https");
    expect(line).toContain("&lt;!channel&gt;");
    expect(line).toContain("&amp; done");
    expect(line).toContain("'x'");
  });

  it("puts a multi-line message on one line and cuts it", () => {
    const line = ciLine(
      input({ evidence: `first\nsecond ${"y".repeat(300)}` })
    );
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(260);
  });
});

describe(ciSlackMessage, () => {
  it("carries the same line as the fallback text and as its only block", () => {
    const message = ciSlackMessage(input());
    expect(message.text).toBe(ciLine(input()));
    expect(message.attachments).toStrictEqual([]);
    expect(message.blocks).toStrictEqual([
      { text: { text: message.text, type: "mrkdwn" }, type: "section" },
    ]);
  });
});

describe(chaseFailedMessage, () => {
  it("names the pull request and the error code", () => {
    const message = chaseFailedMessage({ code: "model_error", pullRequest });
    expect(message.text).toBe(
      "https://github.com/PunGrumpy/baymi/pull/7 ไล่ CI ไม่สำเร็จ session ล้มกลางทาง (code model_error) เช็กผลเองหรือรอ digest"
    );
  });

  it("omits the code when there is none", () => {
    expect(chaseFailedMessage({ pullRequest }).text).not.toContain("code");
  });
});
