/**
 * A session that dies without saying so is worse than one that errors loudly:
 * the thread simply stops, and the person waiting has no way to tell a slow
 * turn from a dead one. These build the message that says so.
 */

interface FailureEvent {
  readonly code?: string;
  readonly message?: string;
}

const DEFAULT_MAX_LENGTH = 160;

/**
 * One line of text, truncated. An error message carries a stack or a provider
 * payload often enough that posting it whole would flood the thread it is
 * apologizing in.
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
  const hint = event.message?.trim();
  const lines = [
    `${lead}${hint ? ` (${flattenInline(hint)})` : ""}.`,
    "",
    guidance,
  ];
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
  const hint = event.message ? ` (${flattenInline(event.message)})` : "";
  const code = event.code ? ` [${event.code}]` : "";
  return `${lead}${hint}${code}. ${guidance}`;
};
