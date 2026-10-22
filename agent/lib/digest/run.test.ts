import type { SessionAuthContext } from "eve/context";
import { describe, expect, it, vi } from "vitest";

import type { PullRequestFacts } from "#lib/digest/classify";
import type { DigestDeps } from "#lib/digest/run";
import { runDigest } from "#lib/digest/run";
import { bangkokDayStart } from "#lib/digest/scope";

/** What eve gives a schedule handler as `appAuth` (`docs/notes.md`). */
const APP_AUTH: SessionAuthContext = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

const MORNING = new Date("2026-10-23T01:00:00.000Z");

const green = (number: number): PullRequestFacts => ({
  author: { isBot: false, login: "PunGrumpy" },
  baseFailingChecks: [],
  baseRef: "main",
  behind: false,
  checks: [{ name: "Test", state: "success", timedOut: false }],
  conflicting: false,
  draft: false,
  headRef: `feat/${number}`,
  lastComment: null,
  number,
  readFailed: false,
  repository: "PunGrumpy/baymi",
  reviewDecision: "none",
  threads: [],
  title: "feat: a thing",
});

/**
 * A Slack that remembers what was posted, like the real conversation does,
 * so the second run of a test sees what the first one left.
 */
const fakes = (facts: readonly PullRequestFacts[] = [green(1)]) => {
  const posted: { key: string; text: string }[] = [];
  const deps = {
    alreadyPosted: vi.fn<DigestDeps["alreadyPosted"]>((key) =>
      Promise.resolve(posted.some((message) => message.key === key))
    ),
    installedRepositories: vi.fn<DigestDeps["installedRepositories"]>(() =>
      Promise.resolve(["PunGrumpy/baymi", "PunGrumpy/nipa"])
    ),
    listOpenPullRequests: vi.fn<DigestDeps["listOpenPullRequests"]>(() =>
      Promise.resolve({ facts, truncated: false })
    ),
    now: () => MORNING,
    post: vi.fn<DigestDeps["post"]>((text, key) => {
      posted.push({ key, text });
      return Promise.resolve();
    }),
  } satisfies DigestDeps;
  return { deps, posted };
};

describe(runDigest, () => {
  it("reads, classifies, renders and posts one digest", async () => {
    const { deps, posted } = fakes([green(1), green(2)]);
    const outcome = await runDigest(deps, APP_AUTH);
    expect(outcome).toMatchObject({
      counts: { blocked: 0, healthy: 0, "needs-owner": 2 },
      status: "posted",
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.text).toBe(
      [
        "https://github.com/PunGrumpy/baymi/pull/1 เขียวแล้ว รอคุณกด merge",
        "https://github.com/PunGrumpy/baymi/pull/2 เขียวแล้ว รอคุณกด merge",
        "อีก 0 อันปกติ",
      ].join("\n")
    );
  });

  it("searches the owners of the installed repositories, for today", async () => {
    const { deps } = fakes();
    await runDigest(deps, APP_AUTH);
    expect(deps.listOpenPullRequests).toHaveBeenCalledWith(
      "user:PunGrumpy is:pr is:open draft:false archived:false updated:>=2026-09-23"
    );
  });

  it("posts nothing the second time it runs for the same data", async () => {
    const { deps, posted } = fakes();
    const first = await runDigest(deps, APP_AUTH);
    const second = await runDigest(deps, APP_AUTH);
    expect(first.status).toBe("posted");
    expect(second.status).toBe("duplicate");
    expect(posted).toHaveLength(1);
    expect(deps.post).toHaveBeenCalledOnce();
  });

  it("keys the digest on the Bangkok date alone", async () => {
    const { deps } = fakes();
    const first = await runDigest(deps, APP_AUTH);
    const second = await runDigest(deps, APP_AUTH);
    expect(first).toMatchObject({ key: "2026-10-23", status: "posted" });
    expect(second).toStrictEqual({ key: "2026-10-23", status: "duplicate" });
  });

  it("looks for the key from midnight in Bangkok", async () => {
    const { deps } = fakes();
    await runDigest(deps, APP_AUTH);
    expect(deps.alreadyPosted).toHaveBeenCalledWith(
      expect.any(String),
      bangkokDayStart(MORNING)
    );
  });

  it("posts nothing on a redelivery even when the pull requests changed since", async () => {
    const { deps, posted } = fakes([green(1)]);
    await runDigest(deps, APP_AUTH);
    deps.listOpenPullRequests.mockResolvedValueOnce({
      facts: [green(1), green(2), { ...green(3), conflicting: true }],
      truncated: false,
    });
    const second = await runDigest(deps, APP_AUTH);
    expect(second.status).toBe("duplicate");
    expect(posted).toHaveLength(1);
  });

  it("posts again the next Bangkok day", async () => {
    const { deps, posted } = fakes([green(1)]);
    await runDigest(deps, APP_AUTH);
    const nextMorning = new Date("2026-10-26T01:00:00.000Z");
    const second = await runDigest(
      { ...deps, now: () => nextMorning },
      APP_AUTH
    );
    expect(second).toMatchObject({ key: "2026-10-26", status: "posted" });
    expect(posted.map(({ key }) => key)).toStrictEqual([
      "2026-10-23",
      "2026-10-26",
    ]);
  });

  it("counts the Bangkok date, not the UTC one, at the day's edge", async () => {
    const { deps, posted } = fakes([green(1)]);
    // 17:30 UTC on the 22nd is 00:30 on the 23rd in Bangkok.
    const lateEvening = new Date("2026-10-22T17:30:00.000Z");
    await runDigest({ ...deps, now: () => lateEvening }, APP_AUTH);
    expect(posted.map(({ key }) => key)).toStrictEqual(["2026-10-23"]);
  });

  it("says so, once, on a day with no pull requests", async () => {
    const { deps, posted } = fakes([]);
    await runDigest(deps, APP_AUTH);
    await runDigest(deps, APP_AUTH);
    expect(posted.map(({ text }) => text)).toStrictEqual([
      "ไม่มี PR ที่เปิดอยู่ในช่วง 30 วันนี้",
    ]);
  });

  it("leaves a draft out", async () => {
    const { deps, posted } = fakes([{ ...green(1), draft: true }]);
    await runDigest(deps, APP_AUTH);
    expect(posted[0]?.text).toBe("ไม่มี PR ที่เปิดอยู่ในช่วง 30 วันนี้");
  });

  it("does nothing when the App is installed nowhere", async () => {
    const { deps, posted } = fakes();
    deps.installedRepositories.mockResolvedValueOnce([]);
    await expect(runDigest(deps, APP_AUTH)).resolves.toStrictEqual({
      status: "nothing-installed",
    });
    expect(deps.listOpenPullRequests).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it("does not post when it cannot tell whether it already did", async () => {
    const { deps, posted } = fakes();
    deps.alreadyPosted.mockRejectedValueOnce(
      new Error("conversations.history: not_in_channel")
    );
    await expect(runDigest(deps, APP_AUTH)).rejects.toThrow("not_in_channel");
    expect(posted).toHaveLength(0);
  });

  it("does not post when GitHub cannot be read", async () => {
    const { deps, posted } = fakes();
    deps.listOpenPullRequests.mockRejectedValueOnce(new Error("GitHub 502"));
    await expect(runDigest(deps, APP_AUTH)).rejects.toThrow("GitHub 502");
    expect(posted).toHaveLength(0);
  });

  it("lets a failed post throw, and the next run tries again", async () => {
    const { deps, posted } = fakes();
    deps.post.mockRejectedValueOnce(new Error("channel_not_found"));
    await expect(runDigest(deps, APP_AUTH)).rejects.toThrow(
      "channel_not_found"
    );
    expect(posted).toHaveLength(0);
    const retry = await runDigest(deps, APP_AUTH);
    expect(retry.status).toBe("posted");
  });

  it("lists a pull request whose checks could not be read on its own line, not as green", async () => {
    const { deps, posted } = fakes([
      green(1),
      { ...green(2), checks: [], readFailed: true },
    ]);
    await runDigest(deps, APP_AUTH);
    expect(posted[0]?.text.split("\n")).toStrictEqual([
      "https://github.com/PunGrumpy/baymi/pull/1 เขียวแล้ว รอคุณกด merge",
      "https://github.com/PunGrumpy/baymi/pull/2 อ่านสถานะ CI จาก GitHub ไม่สำเร็จ ยังไม่รู้ว่าเขียวหรือแดง ต้องเปิดดูเอง",
      "อีก 0 อันปกติ",
    ]);
  });

  describe("a stack whose lowest pull request breaks a check", () => {
    // #54 breaks `test` on its own; #53, #55 and #56 sit above it and contain
    // its commits, so they fail `test` too. main is green.
    const failingAbove = (
      number: number,
      baseRef: string
    ): PullRequestFacts => ({
      ...green(number),
      baseRef,
      checks: [{ name: "test", state: "failure", timedOut: false }],
    });
    const stack = [
      failingAbove(54, "main"),
      failingAbove(53, "feat/54"),
      failingAbove(55, "feat/53"),
      failingAbove(56, "feat/55"),
    ].map((facts) => ({ ...facts, headRef: `feat/${facts.number}` }));

    it("tells every pull request, the culprit included, what it knows and no more", async () => {
      const { deps, posted } = fakes(stack);
      await runDigest(deps, APP_AUTH);
      const lines = posted[0]?.text.split("\n") ?? [];
      const sentence =
        "CI ล้ม (`test`) ล้มเหมือนกันบน PR อื่นในรีโปนี้อีก 3 อัน ยังแยกไม่ได้ว่าจาก diff หรือไม่ ต้องเปิด log ดู";
      expect(lines.slice(0, 4)).toStrictEqual(
        [53, 54, 55, 56].map(
          (number) =>
            `https://github.com/PunGrumpy/baymi/pull/${number} ${sentence}`
        )
      );
    });

    it("never says not from the diff, nor that main fails, when main is green", async () => {
      const { deps, posted } = fakes(stack);
      await runDigest(deps, APP_AUTH);
      expect(posted[0]?.text).not.toContain("ไม่ใช่จาก diff");
      expect(posted[0]?.text).not.toContain("`main`");
    });
  });

  describe("who it runs as", () => {
    it.each([
      [
        "a person at the terminal",
        {
          attributes: {},
          authenticator: "local-dev",
          principalId: "local-dev",
          principalType: "local-dev",
        },
      ],
      [
        "the security reviewer",
        {
          attributes: {},
          authenticator: "github-webhook",
          principalId: "github:baymiai",
          principalType: "service",
        },
      ],
    ] satisfies [string, SessionAuthContext][])(
      "refuses %s",
      async (_name, auth) => {
        const { deps, posted } = fakes();
        await expect(runDigest(deps, auth)).rejects.toThrow("the app");
        expect(deps.installedRepositories).not.toHaveBeenCalled();
        expect(posted).toHaveLength(0);
      }
    );
  });
});
