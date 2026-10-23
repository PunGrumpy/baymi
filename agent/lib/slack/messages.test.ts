import { describe, expect, it } from "vitest";
import { z } from "zod";

import { hasKeyedMessage, postKeyedText } from "#lib/slack/messages";
import type { FetchLike } from "#lib/slack/notify";

const KEY = { eventType: "baymi_digest", key: "2026-10-23" };

/** The request fields these tests look at, whichever method sent them. */
const REQUEST = z.looseObject({
  channel: z.string().optional(),
  cursor: z.string().optional(),
  include_all_metadata: z.boolean().optional(),
  metadata: z
    .object({
      event_payload: z.object({ key: z.string() }),
      event_type: z.string(),
    })
    .optional(),
  oldest: z.string().optional(),
  text: z.string().optional(),
  unfurl_links: z.boolean().optional(),
  unfurl_media: z.boolean().optional(),
});

type Request = z.infer<typeof REQUEST>;

interface Call {
  readonly body: Request;
  readonly method: string;
}

/** Answers each Slack method with the next body queued for it. */
const slack = (answers: Readonly<Record<string, object[]>>) => {
  const calls: Call[] = [];
  const queued = new Map(
    Object.entries(answers).map(([method, bodies]) => [method, [...bodies]])
  );
  const fetchImpl: FetchLike = (input, init) => {
    const method = input.split("/").at(-1) ?? "";
    calls.push({ body: REQUEST.parse(JSON.parse(init.body)), method });
    const next = queued.get(method)?.shift() ?? {
      error: "no_answer",
      ok: false,
    };
    return Promise.resolve({ json: () => Promise.resolve(next) });
  };
  return { calls, fetchImpl };
};

const message = (key?: string, eventType = KEY.eventType) => ({
  metadata:
    key === undefined
      ? undefined
      : { event_payload: { key }, event_type: eventType },
});

describe(postKeyedText, () => {
  it("posts the text with the key in its metadata and no link previews", async () => {
    const { calls, fetchImpl } = slack({
      "chat.postMessage": [{ ok: true, ts: "1792.1" }],
    });
    const result = await postKeyedText({
      fetchImpl,
      key: KEY,
      target: "C0123456789",
      text: "hello",
      token: "xoxb",
    });
    expect(result).toStrictEqual({ ok: true, ts: "1792.1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toStrictEqual({
      channel: "C0123456789",
      metadata: {
        event_payload: { key: "2026-10-23" },
        event_type: "baymi_digest",
      },
      text: "hello",
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it("opens the direct message first when the target is a member", async () => {
    const { calls, fetchImpl } = slack({
      "chat.postMessage": [{ ok: true, ts: "1.1" }],
      "conversations.open": [{ channel: { id: "D0DM" }, ok: true }],
    });
    await postKeyedText({
      fetchImpl,
      key: KEY,
      target: "U0MEMBER12",
      text: "hello",
      token: "xoxb",
    });
    expect(calls.map(({ method }) => method)).toStrictEqual([
      "conversations.open",
      "chat.postMessage",
    ]);
    expect(calls[1]?.body.channel).toBe("D0DM");
  });

  it("reports Slack's refusal with the method that gave it", async () => {
    const { fetchImpl } = slack({
      "chat.postMessage": [{ error: "channel_not_found", ok: false }],
    });
    await expect(
      postKeyedText({
        fetchImpl,
        key: KEY,
        target: "C0123456789",
        text: "x",
        token: "t",
      })
    ).resolves.toStrictEqual({
      error: "chat.postMessage: channel_not_found",
      ok: false,
    });
  });
});

describe(hasKeyedMessage, () => {
  const ask = (answers: Readonly<Record<string, object[]>>) => {
    const { calls, fetchImpl } = slack(answers);
    return {
      calls,
      result: hasKeyedMessage({
        fetchImpl,
        key: KEY,
        oldest: 1_792_000_000,
        target: "C0123456789",
        token: "t",
      }),
    };
  };

  it("finds the key in the metadata of a message from today", async () => {
    const { calls, result } = ask({
      "conversations.history": [
        { messages: [message(), message("2026-10-23")], ok: true },
      ],
    });
    await expect(result).resolves.toBeTruthy();
    expect(calls[0]?.body).toMatchObject({
      channel: "C0123456789",
      include_all_metadata: true,
      oldest: "1792000000",
    });
  });

  it("is false when no message carries the key", async () => {
    const { result } = ask({
      "conversations.history": [
        { messages: [message("2026-10-22"), message()], ok: true },
      ],
    });
    await expect(result).resolves.toBeFalsy();
  });

  it("does not take another event type's key for its own", async () => {
    const { result } = ask({
      "conversations.history": [
        {
          messages: [message("2026-10-23", "something_else")],
          ok: true,
        },
      ],
    });
    await expect(result).resolves.toBeFalsy();
  });

  it("reads the next page when the first does not have it", async () => {
    const { calls, result } = ask({
      "conversations.history": [
        {
          messages: [message()],
          ok: true,
          response_metadata: { next_cursor: "page2" },
        },
        { messages: [message("2026-10-23")], ok: true },
      ],
    });
    await expect(result).resolves.toBeTruthy();
    expect(calls[1]?.body.cursor).toBe("page2");
  });

  it("throws when Slack will not say, rather than let the caller guess no", async () => {
    const { result } = ask({
      "conversations.history": [{ error: "not_in_channel", ok: false }],
    });
    await expect(result).rejects.toThrow("not_in_channel");
  });

  describe("a history longer than the pages it will read", () => {
    const endless = (pages: number) =>
      Array.from({ length: pages }, (_, index) => ({
        messages: [message()],
        ok: true,
        response_metadata: { next_cursor: `page${index + 2}` },
      }));

    it("throws rather than answer not posted yet", async () => {
      const { calls, result } = ask({ "conversations.history": endless(6) });
      await expect(result).rejects.toThrow("unknown");
      expect(calls).toHaveLength(5);
    });

    it("still finds the key on the last page it reads", async () => {
      const { result } = ask({
        "conversations.history": [
          ...endless(4),
          { messages: [message("2026-10-23")], ok: true },
        ],
      });
      await expect(result).resolves.toBeTruthy();
    });

    it("is false, not an error, when the last page it reads is the last page there is", async () => {
      const { result } = ask({
        "conversations.history": [...endless(4), { messages: [], ok: true }],
      });
      await expect(result).resolves.toBeFalsy();
    });
  });
});
