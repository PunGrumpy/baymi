import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Inbound auth for the eve route, which the dev terminal UI, the eval
 * runner, and direct API calls use.
 *
 * @remarks
 * `localDev()` is open on localhost and ignored in production; `vercelOidc()`
 * lets the eve TUI and this project's own deployments reach the agent. There
 * is no browser auth because there is no browser channel.
 */
export default eveChannel({ auth: [localDev(), vercelOidc()] });
