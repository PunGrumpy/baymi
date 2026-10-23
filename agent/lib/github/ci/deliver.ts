import { hasKeyedMessage, postKeyedText } from "#lib/slack/messages";
import type { FetchLike } from "#lib/slack/notify";

/**
 * A chase's Slack line, sent once across every instance that runs the chase.
 *
 * @remarks
 * Delivery is at-least-once, and a redelivered webhook or a re-executed turn
 * can land on a cold instance whose in-memory ledger never saw the first
 * line. So the line is posted through the store the digest uses
 * (`#lib/slack/messages`): the chase key rides in the message's metadata,
 * and the channel's recent history is read for it before posting. The post
 * is its own record, so a run that dies after Slack took the line has
 * nothing left to write down.
 *
 * It fails closed. When the history cannot be read (the bot is not in the
 * channel, or the history runs past the pages read), nothing is posted:
 * a line that may already be there is not worth a second one, and the
 * morning digest carries the pull request anyway. Two deliveries that look
 * at the same moment can still both post, since Slack has no compare-and-set.
 */

/** The `event_type` a chase's line is tagged with, beside the digest's `baymi_digest`. */
export const CI_EVENT_TYPE = "baymi_ci";

/**
 * How far back a redelivery is looked for. GitHub keeps a delivery for three
 * days, which is as late as a manual redelivery can come; a queue retry comes
 * within minutes.
 */
const LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

const MILLISECONDS_PER_SECOND = 1000;

export type LineDelivery =
  | { readonly status: "delivered" }
  | { readonly status: "duplicate" }
  | { readonly error: string; readonly status: "unsent" };

/** Posts `text` under `key` unless the conversation already holds a message with that key. */
export const sendLineOnce = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly key: string;
  readonly now: Date;
  readonly target: string;
  readonly text: string;
  readonly token: string;
}): Promise<LineDelivery> => {
  const { fetchImpl, now, target, text, token } = input;
  const key = { eventType: CI_EVENT_TYPE, key: input.key };
  const oldest =
    Math.floor(now.getTime() / MILLISECONDS_PER_SECOND) - LOOKBACK_SECONDS;
  let posted: boolean;
  try {
    posted = await hasKeyedMessage({ fetchImpl, key, oldest, target, token });
  } catch (error) {
    return { error: `history unread: ${String(error)}`, status: "unsent" };
  }
  if (posted) {
    return { status: "duplicate" };
  }
  const delivery = await postKeyedText({ fetchImpl, key, target, text, token });
  return delivery.ok
    ? { status: "delivered" }
    : { error: delivery.error, status: "unsent" };
};
