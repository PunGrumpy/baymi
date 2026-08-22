/**
 * A session that dies without saying so is worse than one that errors loudly:
 * the thread simply stops, and the person waiting has no way to tell a slow
 * turn from a dead one. These build the message that says so.
 *
 * @remarks
 * What they no longer carry is the provider's own words, which used to be
 * interpolated straight into a comment on someone else's issue. Three things
 * were wrong with that, and the first is the one that gets noticed: the model
 * answers through a gateway of the operator's choosing, and this one replies in
 * Chinese, so the reader of a public GitHub thread got a sentence they could
 * neither act on nor read.
 *
 * The second is audience. `agent/channels/github.ts` already declines to post
 * anything when an autonomous triage turn dies, because "the reporter did not
 * ask for this turn and should not be handed the agent's error in their own
 * issue". A raw provider payload is that same intrusion on every other path,
 * just smaller.
 *
 * The third is what the payload can contain. A gateway rejection often quotes
 * the request back, and rejections that arrive in Chinese are typically
 * content-filter ones, which is exactly the class that quotes the material it
 * objected to. That material is an issue body or a Slack message somebody else
 * wrote, and `agent/hooks/evlog.ts` refuses to send that anywhere at all with
 * `message: "omit"`. A failure notice was routing it somewhere worse than
 * telemetry: a public thread.
 *
 * So a reader gets what they can act on plus the code, which is opaque and
 * forwardable, and the text goes to {@link failureDetail} for the runtime log.
 */

interface FailureEvent {
  readonly code?: string;
  readonly message?: string;
}

const DEFAULT_MAX_LENGTH = 160;

/** A log line is read by one person on purpose, so it can afford more room. */
const LOG_MAX_LENGTH = 800;

/**
 * One line of text, truncated. An error message carries a stack or a provider
 * payload often enough that keeping it whole would flood whatever it lands in.
 */
export const flattenInline = (
  text: string,
  max: number = DEFAULT_MAX_LENGTH
): string => {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

/**
 * Markdown failure notice, for a surface that renders it: GitHub and Linear.
 * The error code goes last and quietly, since it means nothing to the reader
 * but everything to whoever they forward it to.
 */
export const failureNotice = (
  lead: string,
  guidance: string,
  event: FailureEvent
): string => {
  const lines = [`${lead}.`, "", guidance];
  if (event.code) {
    lines.push("", `_Error code: \`${event.code}\`_`);
  }
  return lines.join("\n");
};

/** The same failure as one line, for a chat surface where a block reads badly. */
export const failureLine = (
  lead: string,
  guidance: string,
  event: FailureEvent
): string => {
  const code = event.code ? ` [${event.code}]` : "";
  return `${lead}${code}. ${guidance}`;
};

/** What died: one turn, or the session around it. */
type FailureScope = "session" | "turn";

/** The same failure as one line for a log, where the provider's text belongs. */
export const failureDetail = (
  scope: FailureScope,
  event: FailureEvent
): string => {
  const parts = [`[baymi] ${scope} failed`];
  if (event.code) {
    parts.push(`code=${event.code}`);
  }
  if (event.message?.trim()) {
    parts.push(flattenInline(event.message, LOG_MAX_LENGTH));
  }
  return parts.join(" ");
};

/**
 * Writes the failure somewhere only the deployment can read.
 *
 * @remarks
 * Every channel calls this beside the notice it posts, so the decision about
 * where the provider's text is allowed to go is made here once rather than
 * re-made at six call sites. Vercel captures the console per invocation, which
 * is what makes it the right destination: it is the machine the agent already
 * runs on rather than a reader or a third party.
 *
 * The failure *rate* needs nothing from this. `eve.phase` is already on every
 * turn event and the Reliability dashboard already plots it; what was missing
 * was the text, and text belongs in a log.
 */
export const logFailure = (scope: FailureScope, event: FailureEvent): void => {
  console.error(failureDetail(scope, event));
};
