import { z } from "zod";

import type { PullRequestRef } from "#lib/github/pull-requests";

/**
 * The messages the agent sends to Slack on its own, without a session there.
 *
 * @remarks
 * These are check-ins, not reports: one card with a link, sent when
 * something happened that the maintainer would want to hear about before
 * they next open GitHub. A finding serious enough to act on today, or a
 * review that could not finish. Everything else waits for them to ask.
 */

/** The severities that justify a message the maintainer did not ask for. */
export const NOTIFIED_SEVERITIES = ["critical", "high"] as const;

export type NotifiedSeverity = (typeof NOTIFIED_SEVERITIES)[number];

/** What happened, in the two shapes a check-in can take. */
export type CheckInEvent =
  | {
      readonly kind: "finding";
      readonly severity: NotifiedSeverity;
      readonly summary: string;
    }
  | { readonly code?: string; readonly kind: "review-failed" };

/** Everything a check-in card is built from. */
export interface CheckInInput {
  readonly event: CheckInEvent;
  readonly headSha?: string | null;
  /** When the card is posted; the reader's Slack renders it in their zone. */
  readonly now: Date;
  readonly pullRequest: PullRequestRef;
}

/** The three Block Kit shapes a check-in is built from. */
interface SectionBlock {
  readonly text: { readonly text: string; readonly type: "mrkdwn" };
  readonly type: "section";
}

interface LinkButton {
  readonly style?: "primary";
  readonly text: {
    readonly emoji: false;
    readonly text: string;
    readonly type: "plain_text";
  };
  readonly type: "button";
  readonly url: string;
}

interface ActionsBlock {
  readonly elements: readonly LinkButton[];
  readonly type: "actions";
}

export type SlackBlock = ActionsBlock | SectionBlock;

/** A Slack message with a plain-text fallback, blocks, and a colored attachment. */
export interface SlackMessagePayload {
  readonly attachments: readonly {
    readonly blocks: readonly SlackBlock[];
    readonly color: string;
  }[];
  readonly blocks: readonly SlackBlock[];
  readonly text: string;
}

/** Vercel's status dot, the one visual the reader scans for. */
const STATUS_DOT = {
  critical: ":red_circle:",
  high: ":large_orange_circle:",
  "review-failed": ":white_circle:",
} as const;

/** The color of the bar down the left of the details, one per state. */
const BAR_COLOR = {
  critical: "#EE0000",
  high: "#F5A623",
  "review-failed": "#666666",
} as const;

const SHORT_SHA_LENGTH = 7;

/** mrkdwn link to the pull request, `owner/repo #12`. */
const link = (pullRequest: PullRequestRef): string =>
  `<${pullRequest.url}|${pullRequest.repository} #${pullRequest.number}>`;

/** `<url|label>` in mrkdwn, reduced to its label for the plain-text fallback. */
const MRKDWN_LINK = /<[^|]+\|(?<label>[^>]+)>/u;

/** Slack renders this in the reader's own time zone. */
const when = (now: Date): string => {
  const unix = Math.floor(now.getTime() / 1000);
  return `<!date^${unix}^{date_short_pretty} at {time}|${now.toISOString()}>`;
};

const headline = (input: CheckInInput): string => {
  const { event, pullRequest } = input;
  if (event.kind === "finding") {
    return `${link(pullRequest)} has a ${event.severity} finding`;
  }
  return `${link(pullRequest)} review did not finish`;
};

const detail = (event: CheckInEvent): string => {
  if (event.kind === "finding") {
    return event.summary.trim();
  }
  const code = event.code ? ` (error code \`${event.code}\`)` : "";
  return `Mention @baymiai on the pull request and I will try again${code}.`;
};

/** `858f54e | acme/widgets | via Baymi security review | Today at 10:35 AM`. */
const metadata = (input: CheckInInput): string => {
  const parts: string[] = [];
  if (input.headSha) {
    parts.push(`\`${input.headSha.slice(0, SHORT_SHA_LENGTH)}\``);
  }
  parts.push(
    input.pullRequest.repository,
    "via Baymi security review",
    when(input.now)
  );
  return parts.join(" | ");
};

const button = (label: string, url: string): LinkButton => ({
  text: { emoji: false, text: label, type: "plain_text" },
  type: "button",
  url,
});

const primaryButton = (label: string, url: string): LinkButton => ({
  ...button(label, url),
  style: "primary",
});

/**
 * The check-in, in the shape Vercel's own deployment messages use: a bold
 * headline behind a status dot, the details in a colored bar, and two link
 * buttons. `text` is the fallback for notifications and clients that do not
 * render blocks, and it says the same thing on one line.
 */
export const checkInMessage = (input: CheckInInput): SlackMessagePayload => {
  const { event, pullRequest } = input;
  const state = event.kind === "finding" ? event.severity : event.kind;
  const title = headline(input);
  return {
    attachments: [
      {
        blocks: [
          {
            text: {
              text: `${detail(event)}\n${metadata(input)}`,
              type: "mrkdwn",
            },
            type: "section",
          },
          {
            elements: [
              primaryButton("View pull request", pullRequest.url),
              button("Files changed", `${pullRequest.url}/files`),
            ],
            type: "actions",
          },
        ],
        color: BAR_COLOR[state],
      },
    ],
    blocks: [
      {
        text: { text: `${STATUS_DOT[state]} *${title}*`, type: "mrkdwn" },
        type: "section",
      },
    ],
    text: `${title.replace(MRKDWN_LINK, "$<label>")}: ${detail(event)}`,
  };
};

const SLACK_API = "https://slack.com/api";

/** The `chat.postMessage` body: the payload addressed to one conversation. */
interface SlackPost extends SlackMessagePayload {
  readonly channel: string;
}

/** The failure envelope every Slack Web API method shares. */
const SLACK_FAILURE = z.object({
  error: z.string().default("unknown_error"),
  ok: z.literal(false),
});

const CONVERSATION_OPENED = z.union([
  z.object({ channel: z.object({ id: z.string() }), ok: z.literal(true) }),
  SLACK_FAILURE,
]);

const MESSAGE_POSTED = z.union([
  z.object({ ok: z.literal(true) }),
  SLACK_FAILURE,
]);

/** The one call this needs, narrowed so a test can supply one. */
export type FetchLike = (
  input: string,
  init: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "POST";
  }
) => Promise<{ readonly json: () => Promise<object> }>;

/** What a delivery attempt came to. */
export type Delivery =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false };

const slackCall = async <Payload>(
  schema: z.ZodType<Payload>,
  fetchImpl: FetchLike,
  token: string,
  method: string,
  body: Readonly<Record<string, string>> | SlackPost
): Promise<Payload> => {
  const response = await fetchImpl(`${SLACK_API}/${method}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  return schema.parse(await response.json());
};

/** Whether a Slack ID names a person rather than a conversation. */
const isMemberId = (id: string): boolean => /^[UW]/u.test(id);

/**
 * Posts one message to a Slack conversation, opening the direct message
 * first when the target is a person. Sent as `text` plus `blocks` and
 * `attachments`, so a client that renders none of the rich parts still
 * shows the one line.
 *
 * @remarks
 * Two calls at most, parsed rather than asserted: a body Slack changed the
 * shape of fails here with the method name in the error rather than as an
 * undefined property later. The bot needs `chat:write`, plus `im:write` when
 * the target is a member.
 */
export const postSlackMessage = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly message: SlackMessagePayload;
  readonly target: string;
  readonly token: string;
}): Promise<Delivery> => {
  const { fetchImpl = fetch, message, target, token } = input;
  let channel = target;
  if (isMemberId(target)) {
    const opened = await slackCall(
      CONVERSATION_OPENED,
      fetchImpl,
      token,
      "conversations.open",
      { users: target }
    );
    if (!opened.ok) {
      return { error: `conversations.open: ${opened.error}`, ok: false };
    }
    channel = opened.channel.id;
  }
  const posted = await slackCall(
    MESSAGE_POSTED,
    fetchImpl,
    token,
    "chat.postMessage",
    { channel, ...message }
  );
  return posted.ok
    ? { ok: true }
    : { error: `chat.postMessage: ${posted.error}`, ok: false };
};
