import { z } from "zod";

import type { FetchLike } from "#lib/slack/notify";
import { resolveConversation, slackCall } from "#lib/slack/notify";

/**
 * Plain-text posts that carry a key, and the lookup that finds them again.
 *
 * @remarks
 * The key rides in Slack's message `metadata`, which the post stores and
 * `conversations.history` returns with `include_all_metadata`, so the post
 * is its own record: a run that crashes after Slack accepted the message has
 * nothing to forget to write down, and the next run finds the key in the
 * conversation. Needs `chat:write` to post and the history scope for the
 * conversation's kind (`channels:history`, `groups:history`, `im:history`) to
 * look, plus `metadata.message:read`, which the bot has.
 */

const HISTORY_PAGE_SIZE = 200;
/** A day of a notify channel is a few messages; this is a bound, not a target. */
const MAX_HISTORY_PAGES = 5;

/** The key Slack carries with a message. */
export interface MessageKey {
  readonly eventType: string;
  readonly key: string;
}

const POSTED = z.union([
  z.object({ ok: z.literal(true), ts: z.string() }),
  z.object({
    error: z.string().default("unknown_error"),
    ok: z.literal(false),
  }),
]);

const HISTORY = z.union([
  z.object({
    messages: z.array(
      z.object({
        metadata: z
          .object({
            event_payload: z.looseObject({ key: z.string().optional() }),
            event_type: z.string(),
          })
          .optional(),
      })
    ),
    ok: z.literal(true),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .optional(),
  }),
  z.object({
    error: z.string().default("unknown_error"),
    ok: z.literal(false),
  }),
]);

/** The `conversations.history` request; an undefined cursor is left out of the JSON. */
interface HistoryRequest {
  readonly channel: string;
  readonly cursor: string | undefined;
  readonly include_all_metadata: true;
  readonly limit: number;
  readonly oldest: string;
}

export type TextDelivery =
  | { readonly ok: true; readonly ts: string }
  | { readonly error: string; readonly ok: false };

/**
 * Posts `text` to a channel or a member's direct message, tagged with `key`.
 * Links are not unfurled: a digest of twenty pull request URLs is a wall of
 * previews otherwise.
 */
export const postKeyedText = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly key: MessageKey;
  readonly target: string;
  readonly text: string;
  readonly token: string;
}): Promise<TextDelivery> => {
  const { fetchImpl = fetch, key, target, text, token } = input;
  const conversation = await resolveConversation({ fetchImpl, target, token });
  if (!conversation.ok) {
    return { error: conversation.error, ok: false };
  }
  const posted = await slackCall(POSTED, fetchImpl, token, "chat.postMessage", {
    channel: conversation.channel,
    metadata: {
      event_payload: { key: key.key },
      event_type: key.eventType,
    },
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  return posted.ok
    ? { ok: true, ts: posted.ts }
    : { error: `chat.postMessage: ${posted.error}`, ok: false };
};

/**
 * Whether a message tagged with `key` was posted to the conversation at or
 * after `oldest` (Unix seconds).
 *
 * @remarks
 * Throws when Slack will not say. A caller that cannot tell whether the
 * digest went out must not guess "no" and post a second one, so the failure
 * is loud. The usual cause is the bot not being a member of a channel, which
 * Slack reports as `not_in_channel`.
 */
export const hasKeyedMessage = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly key: MessageKey;
  readonly oldest: number;
  readonly target: string;
  readonly token: string;
}): Promise<boolean> => {
  const { fetchImpl = fetch, key, oldest, target, token } = input;
  const conversation = await resolveConversation({ fetchImpl, target, token });
  if (!conversation.ok) {
    throw new Error(conversation.error);
  }
  let cursor: string | undefined;
  for (let page = 1; page <= MAX_HISTORY_PAGES; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are sequential by nature
    const history = await slackCall(
      HISTORY,
      fetchImpl,
      token,
      "conversations.history",
      {
        channel: conversation.channel,
        cursor,
        include_all_metadata: true,
        limit: HISTORY_PAGE_SIZE,
        oldest: String(oldest),
      } satisfies HistoryRequest
    );
    if (!history.ok) {
      throw new Error(`conversations.history: ${history.error}`);
    }
    const found = history.messages.some(
      ({ metadata }) =>
        metadata?.event_type === key.eventType &&
        metadata.event_payload.key === key.key
    );
    if (found) {
      return true;
    }
    cursor = history.response_metadata?.next_cursor || undefined;
    if (cursor === undefined) {
      return false;
    }
  }
  return false;
};
