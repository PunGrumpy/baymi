import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { FetchLike, SlackMessagePayload } from "#lib/slack/notify";
import { checkInMessage, postSlackMessage } from "#lib/slack/notify";

const pullRequest = {
  number: 12,
  repository: "acme/widgets",
  url: "https://github.com/acme/widgets/pull/12",
};

const now = new Date("2026-09-11T10:35:00.000Z");

const SECTION = z.object({
  text: z.object({ text: z.string(), type: z.literal("mrkdwn") }),
  type: z.literal("section"),
});

const BUTTON = z.object({
  style: z.literal("primary").optional(),
  text: z.object({
    emoji: z.literal(false),
    text: z.string(),
    type: z.literal("plain_text"),
  }),
  type: z.literal("button"),
  url: z.string(),
});

const ACTIONS = z.object({
  elements: z.array(BUTTON),
  type: z.literal("actions"),
});

const headlineOf = (message: SlackMessagePayload): string => {
  const [first] = message.blocks;
  return SECTION.parse(first).text.text;
};

const detailsOf = (message: SlackMessagePayload) => {
  const [attachment] = message.attachments;
  if (attachment === undefined) {
    throw new Error("no attachment");
  }
  const [section, actions] = attachment.blocks;
  return {
    actions: ACTIONS.parse(actions),
    color: attachment.color,
    section: SECTION.parse(section).text.text,
  };
};

describe(checkInMessage, () => {
  it("leads with a status dot and a bold linked headline, like a deployment", () => {
    const message = checkInMessage({
      event: {
        kind: "finding",
        severity: "high",
        summary: " the new upload endpoint writes to a caller-chosen path ",
      },
      headSha: "72eadbcce5b7e4cc88",
      now,
      pullRequest,
    });
    expect(headlineOf(message)).toBe(
      ":large_orange_circle: *<https://github.com/acme/widgets/pull/12|acme/widgets #12> has a high finding*"
    );
    expect(message.text).toBe(
      "acme/widgets #12 has a high finding: the new upload endpoint writes to a caller-chosen path"
    );
  });

  it("puts the summary and the metadata line in a colored bar with two buttons", () => {
    const { actions, color, section } = detailsOf(
      checkInMessage({
        event: {
          kind: "finding",
          severity: "critical",
          summary: "a secret is committed",
        },
        headSha: "72eadbcce5b7e4cc88",
        now,
        pullRequest,
      })
    );
    expect(color).toBe("#EE0000");
    expect(section).toBe(
      "a secret is committed\n`72eadbc` | acme/widgets | via Baymi security review | <!date^1789122900^{date_short_pretty} at {time}|2026-09-11T10:35:00.000Z>"
    );
    expect(actions.elements).toStrictEqual([
      {
        style: "primary",
        text: { emoji: false, text: "View pull request", type: "plain_text" },
        type: "button",
        url: pullRequest.url,
      },
      {
        text: { emoji: false, text: "Files changed", type: "plain_text" },
        type: "button",
        url: `${pullRequest.url}/files`,
      },
    ]);
  });

  it("describes a failed review in the same shape, with the error code", () => {
    const message = checkInMessage({
      event: { code: "E7", kind: "review-failed" },
      now,
      pullRequest,
    });
    expect(headlineOf(message)).toBe(
      ":white_circle: *<https://github.com/acme/widgets/pull/12|acme/widgets #12> review did not finish*"
    );
    const { color, section } = detailsOf(message);
    expect(color).toBe("#666666");
    // No sha was recorded, so the metadata line starts at the repository.
    expect(section).toBe(
      "Mention @baymiai on the pull request and I will try again (error code `E7`).\nacme/widgets | via Baymi security review | <!date^1789122900^{date_short_pretty} at {time}|2026-09-11T10:35:00.000Z>"
    );
  });
});

const respond = (bodies: readonly object[]) => {
  const fetchImpl = vi.fn<FetchLike>();
  for (const body of bodies) {
    fetchImpl.mockResolvedValueOnce({ json: () => Promise.resolve(body) });
  }
  return fetchImpl;
};

const SENT_BODY = z.looseObject({ channel: z.string(), text: z.string() });

const sentBody = (
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
  call: number
) => SENT_BODY.parse(JSON.parse(String(fetchImpl.mock.calls[call]?.[1].body)));

const message = checkInMessage({
  event: { kind: "finding", severity: "high", summary: "hello" },
  now,
  pullRequest,
});

describe(postSlackMessage, () => {
  it("posts the fallback text, the blocks, and the attachment to a channel", async () => {
    const fetchImpl = respond([{ ok: true }]);
    await expect(
      postSlackMessage({
        fetchImpl,
        message,
        target: "C0123456789",
        token: "xoxb",
      })
    ).resolves.toStrictEqual({ ok: true });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("chat.postMessage");
    expect(sentBody(fetchImpl, 0)).toStrictEqual({
      channel: "C0123456789",
      ...message,
    });
  });

  it("opens the direct message first when the target is a person", async () => {
    const fetchImpl = respond([
      { channel: { id: "D0DMDMDMDM" }, ok: true },
      { ok: true },
    ]);
    await postSlackMessage({
      fetchImpl,
      message,
      target: "U0123456789",
      token: "xoxb",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "conversations.open"
    );
    expect(sentBody(fetchImpl, 1).channel).toBe("D0DMDMDMDM");
  });

  it("reports Slack's reason instead of throwing", async () => {
    const fetchImpl = respond([{ error: "channel_not_found", ok: false }]);
    await expect(
      postSlackMessage({
        fetchImpl,
        message,
        target: "C0123456789",
        token: "xoxb",
      })
    ).resolves.toStrictEqual({
      error: "chat.postMessage: channel_not_found",
      ok: false,
    });
  });
});
