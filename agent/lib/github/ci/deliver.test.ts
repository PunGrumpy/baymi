import { describe, expect, it } from "vitest";

import { CI_EVENT_TYPE, sendLineOnce } from "#lib/github/ci/deliver";
import { fakeSlackChannel } from "#lib/github/ci/fixtures";
import type { FetchLike } from "#lib/slack/notify";

const send = (fetchImpl: FetchLike, key: string) =>
  sendLineOnce({
    fetchImpl,
    key,
    now: new Date("2026-10-23T02:00:00Z"),
    target: "C0123456789",
    text: "https://github.com/PunGrumpy/baymi/pull/7 CI ล้มจากโค้ดใน PR เอง (test)",
    token: "xoxb-test",
  });

describe(sendLineOnce, () => {
  it("posts the line once, with the key in its metadata", async () => {
    const slack = fakeSlackChannel();
    await expect(
      send(slack.fetchImpl, "pungrumpy/baymi#run77@1")
    ).resolves.toStrictEqual({ status: "delivered" });
    expect(slack.posted).toHaveLength(1);
    expect(slack.posted[0]?.metadata).toStrictEqual({
      event_payload: { key: "pungrumpy/baymi#run77@1" },
      event_type: CI_EVENT_TYPE,
    });
  });

  it("finds the line a cold instance already posted and posts nothing", async () => {
    const slack = fakeSlackChannel();
    await send(slack.fetchImpl, "pungrumpy/baymi#run77@1");
    await expect(
      send(slack.fetchImpl, "pungrumpy/baymi#run77@1")
    ).resolves.toStrictEqual({ status: "duplicate" });
    expect(slack.posted).toHaveLength(1);
  });

  it("posts a second line for another run or another attempt", async () => {
    const slack = fakeSlackChannel();
    await send(slack.fetchImpl, "pungrumpy/baymi#run77@1");
    await send(slack.fetchImpl, "pungrumpy/baymi#run77@2");
    await send(slack.fetchImpl, "pungrumpy/baymi#run78@1");
    expect(slack.posted).toHaveLength(3);
  });

  it("fails closed: posts nothing when the history cannot be read", async () => {
    const slack = fakeSlackChannel("unreadable");
    await expect(
      send(slack.fetchImpl, "pungrumpy/baymi#run77@1")
    ).resolves.toMatchObject({ status: "unsent" });
    expect(slack.posted).toStrictEqual([]);
  });
});
