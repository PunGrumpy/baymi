/**
 * One line to the runtime log for a chase decision that left no other trace:
 * a webhook that started nothing, and a line that had nowhere to go.
 *
 * @remarks
 * A skipped event is the common case and says nothing on GitHub or Slack, so
 * without this a missing chase could not be told from a hook that never ran.
 * Vercel captures the console per invocation, the same destination as
 * `logFailure` (`#lib/failure`).
 */
export const logChase = (message: string): void => {
  console.info(`[baymi] ${message}`);
};
