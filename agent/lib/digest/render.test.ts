import { describe, expect, it } from "vitest";

import type { Classified, DigestContext, Verdict } from "#lib/digest/classify";
import { NO_PULL_REQUESTS, renderDigest } from "#lib/digest/render";

const context: DigestContext = { owners: ["PunGrumpy"] };

const entry = (
  number: number,
  verdict: Verdict,
  overrides: Partial<Classified> = {}
): Classified => ({
  author: { isBot: false, login: "PunGrumpy" },
  baseRef: "main",
  number,
  repository: "PunGrumpy/baymi",
  verdict,
  ...overrides,
});

const ready = (number: number, overrides: Partial<Classified> = {}) =>
  entry(
    number,
    { bucket: "needs-owner", reason: { kind: "ready" } },
    overrides
  );
const healthy = (
  number: number,
  reason: "release" | "stacked" | "waiting-author" | "waiting-ci"
) => entry(number, { bucket: "healthy", reason });
const ci = (
  number: number,
  failure: "diff" | "flake" | "stale-base" | "unknown",
  checks: string[] = ["Typecheck"],
  behind = false
) =>
  entry(number, {
    bucket: "blocked",
    reason: { behind, checks, failure, kind: "ci" },
  });

const linkOf = (number: number, repository = "PunGrumpy/baymi") =>
  `https://github.com/${repository}/pull/${number}`;

describe(renderDigest, () => {
  it("leads with what needs the maintainer, then what is blocked, and ends on the healthy count", () => {
    const text = renderDigest(
      [
        healthy(4, "waiting-ci"),
        ci(3, "diff"),
        ready(2),
        healthy(5, "release"),
      ],
      context
    );
    expect(text.split("\n")).toStrictEqual([
      `${linkOf(2)} เขียวแล้ว รอคุณกด merge`,
      `${linkOf(3)} CI ล้ม (\`Typecheck\`) จากโค้ดใน diff เอง ต้องแก้บน branch`,
      "อีก 2 อันปกติ (1 รอ CI, 1 release PR)",
    ]);
  });

  it("starts with a pull request link, with no preamble", () => {
    const text = renderDigest([ready(2)], context);
    expect(text.startsWith("https://github.com/")).toBeTruthy();
  });

  it("puts conflicts before questions before green, each by repository and number", () => {
    const text = renderDigest(
      [
        ready(9),
        entry(8, {
          bucket: "needs-owner",
          reason: { from: "octocat", kind: "question" },
        }),
        entry(
          7,
          { bucket: "needs-owner", reason: { kind: "conflict" } },
          { repository: "PunGrumpy/zeta" }
        ),
        entry(1, { bucket: "needs-owner", reason: { kind: "conflict" } }),
      ],
      context
    );
    const links = text
      .split("\n")
      .map((line) => line.split(" ")[0])
      .filter((word) => word?.startsWith("https://"));
    expect(links).toStrictEqual([
      linkOf(1),
      linkOf(7, "PunGrumpy/zeta"),
      linkOf(8),
      linkOf(9),
    ]);
  });

  it("names the author of a pull request that is not the maintainer's", () => {
    const text = renderDigest(
      [
        ready(2, { author: { isBot: true, login: "dependabot" } }),
        entry(
          3,
          { bucket: "needs-owner", reason: { kind: "conflict" } },
          { author: { isBot: false, login: "octocat" } }
        ),
      ],
      context
    );
    expect(text).toContain("เขียวแล้ว รอคุณกด merge (โดย `dependabot`)");
    expect(text).toContain("มี conflict กับ `main` ต้องให้ `octocat` แก้");
  });

  it("says what a question is and who asked it", () => {
    const text = renderDigest(
      [
        entry(2, {
          bucket: "needs-owner",
          reason: { from: "octocat", kind: "question" },
        }),
      ],
      context
    );
    expect(text).toContain("มีคำถามจาก `octocat` ที่ยังไม่มีใครตอบ");
  });

  it("gives each failure class its own sentence", () => {
    const text = renderDigest(
      [
        ci(1, "stale-base", ["Vercel"], true),
        ci(2, "flake", ["Test"]),
        ci(3, "unknown", ["Lint"]),
      ],
      context
    );
    expect(text).toContain(
      "CI ล้ม (`Vercel`) เหมือนที่ล้มบน `main` หรือบน PR อื่นในรีโปนี้ ไม่ใช่จาก diff และ branch ตามหลัง base"
    );
    expect(text).toContain(
      "CI ล้ม (`Test`) น่าจะ flake (timeout) ควร rerun ครั้งเดียว"
    );
    expect(text).toContain("CI ล้ม (`Lint`) ยังแยกสาเหตุไม่ได้ ต้องเปิด log ดู");
  });

  it("lists at most three failing checks and counts the rest", () => {
    const text = renderDigest(
      [ci(1, "diff", ["a", "b", "c", "d", "e"])],
      context
    );
    expect(text).toContain("(`a`, `b`, `c` +2)");
  });

  it("counts bot findings by thread", () => {
    const text = renderDigest(
      [
        entry(1, {
          bucket: "blocked",
          reason: { kind: "bot-findings", threads: 2 },
        }),
      ],
      context
    );
    expect(text).toContain("บอทเขียนความเห็นไว้ 2 เธรดที่ยังไม่มีใครดู");
  });

  it("breaks the healthy count down in a fixed order and omits zeros", () => {
    const text = renderDigest(
      [
        ready(1),
        healthy(2, "release"),
        healthy(3, "stacked"),
        healthy(4, "stacked"),
        healthy(5, "waiting-author"),
      ],
      context
    );
    expect(text.split("\n").at(-1)).toBe(
      "อีก 4 อันปกติ (1 รอผู้เขียน, 2 ซ้อนบน PR อื่น, 1 release PR)"
    );
  });

  it("still ends on a healthy count of zero", () => {
    expect(
      renderDigest([ready(1)], context)
        .split("\n")
        .at(-1)
    ).toBe("อีก 0 อันปกติ");
  });

  it("says in one sentence that nothing needs the maintainer", () => {
    const text = renderDigest(
      [healthy(1, "waiting-ci"), healthy(2, "release")],
      context
    );
    expect(text).toBe("ไม่มีอะไรต้องให้คุณดูวันนี้ มี 2 อันปกติ (1 รอ CI, 1 release PR)");
    expect(text).not.toContain("\n");
  });

  it("says so when there are no pull requests at all", () => {
    expect(renderDigest([], context)).toBe(NO_PULL_REQUESTS);
  });

  it("is the same text for the same list", () => {
    const entries = [ci(3, "diff"), ready(2), healthy(4, "waiting-ci")];
    expect(renderDigest(entries, context)).toBe(renderDigest(entries, context));
  });

  describe("text a stranger wrote", () => {
    it("cannot put a mention or a link into the digest", () => {
      const text = renderDigest(
        [ci(1, "diff", ["<!channel> <https://evil.example|click> & more"])],
        context
      );
      expect(text).not.toContain("<!channel>");
      expect(text).not.toContain("<https");
      expect(text).toContain("&lt;!channel&gt;");
      expect(text).toContain("&amp;");
    });

    it("cannot end its code span early or add a line", () => {
      const text = renderDigest(
        [ci(1, "diff", ["a`b\nhttps://evil.example"])],
        context
      );
      expect(text.split("\n")).toHaveLength(2);
      expect(text).toContain("`a b https://evil.example`");
    });

    it("is cut to a readable length", () => {
      const text = renderDigest([ci(1, "diff", ["x".repeat(500)])], context);
      expect(text.length).toBeLessThan(300);
      expect(text).toContain("…");
    });
  });
});
