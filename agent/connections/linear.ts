import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

import { env } from "#lib/env";

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
 * The Linear surface the agent is allowed to reach, listed by name.
 *
 * @remarks
 * Without `tools.allow` the model gets Linear's entire MCP surface, deletes
 * and structural writes included, which is far more than the two things this
 * agent does in Linear: bridge a GitHub issue into one, and answer a question
 * about an existing one. The reads are what it takes to resolve a team, a
 * user, or an issue before writing; the writes are the two the connector's own
 * scopes cover (`issues:create`, `comments:create`). `save_issue` both creates
 * and updates, which is what "create an issue for #12 and assign it to me"
 * needs.
 *
 * Left out on purpose: every delete, and the structural writes for projects,
 * cycles, milestones, documents, and initiatives. None of them has a caller
 * here, and an allow list is only worth having while it stays the smallest one
 * that works.
 */
const ALLOWED_TOOLS: string[] = [
  // Reads
  "get_issue",
  "get_issue_status",
  "get_project",
  "get_team",
  "get_user",
  "list_comments",
  "list_issue_labels",
  "list_issue_statuses",
  "list_issues",
  "list_projects",
  "list_teams",
  "list_users",
  // Writes
  "save_comment",
  "save_issue",
];

/**
 * Linear MCP connection for creating and cross-referencing issues.
 */
export default defineMcpClientConnection({
  auth: linearAuth,
  description:
    "The Linear workspace: read issues, comments, teams, users, projects, and the label and status vocabulary; create or update an issue with `save_issue` and comment with `save_comment`. Use it to bridge GitHub issues into Linear, to check whether something is already tracked, and to answer questions about an issue's state. It cannot delete anything, and it cannot create projects, cycles, milestones, or documents.",
  tools: { allow: ALLOWED_TOOLS },
  url: "https://mcp.linear.app/mcp",
});
