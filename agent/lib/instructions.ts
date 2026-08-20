/**
 * Which channel a system-prompt fragment belongs to, and whether the session
 * that just started should see it.
 */

/** The product surfaces the agent answers on, by eve's channel `kind`. */
export const CHANNEL_KINDS = ["github", "linear", "slack"] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const PRODUCT_SURFACES: ReadonlySet<string> = new Set(CHANNEL_KINDS);

/**
 * Whether the fragment written for `channel` should load into a session that
 * arrived on `kind`.
 *
 * @remarks
 * A session on a product surface sees only its own fragment: a person who
 * mentions the agent on a pull request has no use for the Slack digest
 * rules, and every unused section is context the model has to read past on
 * every turn.
 *
 * Anything that is not a product surface (the HTTP session route behind
 * `eve dev`, the eval runner, a direct API call) sees every fragment. Those
 * surfaces exist to exercise behavior that belongs to some other channel, so
 * withholding a section there would hide the thing under test.
 */
export const loadsOnChannel = (
  channel: ChannelKind,
  kind: string | undefined
): boolean =>
  kind === channel || !(kind !== undefined && PRODUCT_SURFACES.has(kind));
