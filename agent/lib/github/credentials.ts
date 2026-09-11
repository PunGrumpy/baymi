import { connectGitHubCredentials } from "@vercel/connect/eve";
import type { GitHubChannelCredentials } from "eve/channels/github";

import { env } from "#lib/env";

/**
 * GitHub App credentials, shared by the channel and the installation tool:
 * installation tokens from Vercel Connect, webhooks verified against the
 * App's own secret.
 *
 * @remarks
 * The App posts its webhooks straight at `/eve/v1/github` rather than
 * through Connect's trigger forwarder, which is metered per delivery and
 * adds nothing here because the events are identical either way.
 * `connectGitHubCredentials` returns a `webhookVerifier` that checks the
 * signature Connect attaches on the way out; a webhook that came straight
 * from GitHub does not have one, and eve skips the `webhookSecret` path
 * whenever a verifier is present, so the verifier is dropped rather than
 * left in place to reject every delivery. Token minting and rotation stay
 * inside Connect; there is still no App private key in this deployment.
 */
const { webhookVerifier: _connectForwarderVerifier, ...connectGitHub } =
  connectGitHubCredentials(env.GITHUB_CONNECTOR);

export const githubCredentials: GitHubChannelCredentials = {
  ...connectGitHub,
  webhookSecret: env.GITHUB_WEBHOOK_SECRET,
};

/** Resolves the Connect-managed installation token, minting when it is lazy. */
export const mintInstallationToken = async (): Promise<string> => {
  const token = githubCredentials.installationToken;
  if (token === undefined) {
    throw new Error("The GitHub connector exposes no installation token.");
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- eve's contract is a string or a thunk, and this is the boundary that resolves it
  return typeof token === "function" ? await token() : token;
};
