/** eve's channel `kind` for the Slack channel. */
const SLACK_CHANNEL_KIND = "slack";

/**
 * Whether a session that arrived on `kind` should see the `send_slack_dm`
 * tool at all.
 *
 * @remarks
 * The tool exists to deliver something asked for from another surface, a
 * Linear session that ends in "DM me a summary" being the case it was built
 * for. In a Slack session the agent's final message is already posted to the
 * thread, so reaching for the tool there sends the same thing twice.
 *
 * The system prompt says as much, but a prompt is a request and this is not:
 * withholding the tool means the model cannot double-send even when it
 * misreads the rule, and the scheduled digest, which runs as a Slack session,
 * cannot deliver itself out of band.
 */
export const exposesSlackDmTool = (kind: string | undefined): boolean =>
  kind !== SLACK_CHANNEL_KIND;
