import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

import { env } from "#lib/env.js";

/**
 * App-scoped Linear authorization via Vercel Connect.
 *
 * @remarks
 * `principalType: "app"` means no per-user consent flow: tokens are minted for
 * the installation itself, requested per call via `ctx.getToken`, cached per
 * step by eve, and never exposed to the model. Export this if a tool ever needs
 * to call the Linear API directly and should share the same installation.
 */
const linearAuth = connect({
  connector: env.LINEAR_CONNECTOR,
  principalType: "app",
  tokenParams: {
    scopes: ["read", "write", "issues:create", "comments:create"],
  },
});

/**
 * Linear MCP connection for creating and cross-referencing issues.
 */
export default defineMcpClientConnection({
  auth: linearAuth,
  description: "Linear workspace: issues, projects, cycles, and comments.",
  url: "https://mcp.linear.app/mcp",
});
