/**
 * Which channel a system-prompt fragment belongs to, and whether the session
 * that just started should see it.
 */

/** The product channels the agent answers on, by eve's channel name. */
const CHANNEL_KINDS = ["github", "slack"] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const PRODUCT_CHANNELS: ReadonlySet<string> = new Set(CHANNEL_KINDS);

/**
 * The channel name eve reports, without its prefix.
 *
 * @remarks
 * Framework channels arrive bare (`http`, `schedule`); authored ones as
 * `channel:<filename>`. Comparing `kind === "github"` against the prefixed
 * form never matches, silently, so every comparison goes through here.
 */
export const channelName = (kind?: string): string =>
  (kind ?? "unknown").replace(/^channel:/u, "");

/**
 * Whether the fragment written for `channel` should load into a session that
 * arrived on `kind`.
 *
 * @remarks
 * A session on a product channel sees only its own fragment: a person who
 * mentions the agent on a pull request has no use for the Slack rules, and
 * every unused section is context the model reads past on every turn.
 *
 * Anything that is not a product channel (the HTTP session route behind
 * `eve dev`, the eval runner, a direct API call) sees every fragment. Those
 * routes exist to exercise behavior that belongs to some other channel, so
 * withholding a section there would hide the thing under test.
 */
export const loadsOnChannel = (
  channel: ChannelKind,
  kind?: string
): boolean => {
  const name = channelName(kind);
  return name === channel || !PRODUCT_CHANNELS.has(name);
};
