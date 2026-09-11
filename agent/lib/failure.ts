/**
 * A session that dies without saying so is worse than one that errors loudly:
 * the thread simply stops, and the person waiting cannot tell a slow turn
 * from a dead one. These build the message that says so.
 *
 * @remarks
 * None of them includes the provider's own words. A gateway rejection often
 * quotes the request back, and that request is a diff or a comment somebody
 * else wrote, which has no business in a public thread. A reader gets what
 * they can act on plus the error code, which is opaque and forwardable; the
 * text goes to the runtime log through {@link logFailure}.
 */

interface FailureEvent {
  readonly code?: string;
  readonly message?: string;
}

/** A log line is read by one person on purpose, so it can afford more room. */
const LOG_MAX_LENGTH = 800;

/**
 * One line of text, truncated. An error message often includes a stack or a provider
 * payload, and keeping it whole would flood whatever it is written to.
 */
export const flattenInline = (text: string, max: number): string => {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

/**
 * Markdown failure notice, for a channel that renders it. The error code goes
 * last and quietly, since it means nothing to the reader but everything to
 * whoever they forward it to.
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

/** The same failure as one line, for a chat channel where a block reads badly. */
export const failureLine = (
  lead: string,
  guidance: string,
  event: FailureEvent
): string => {
  const code = event.code ? ` [${event.code}]` : "";
  return `${lead}${code}. ${guidance}`;
};

/** What died: one turn, the session around it, or the check-in about either. */
export type FailureScope = "notice" | "review" | "session" | "turn";

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
 * where the provider's text may go is made here once. Vercel captures the
 * console per invocation, which makes it the right destination: the machine
 * the agent already runs on rather than a reader or a third party.
 */
export const logFailure = (scope: FailureScope, event: FailureEvent): void => {
  console.error(failureDetail(scope, event));
};
