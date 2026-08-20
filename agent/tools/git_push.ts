import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "#lib/env";
import {
  pushBrokerPolicy,
  pushUrl,
  validatePushBranch,
  validatePushRepo,
} from "#lib/github/push";
import { isAutonomous } from "#lib/trust";

const credentials = connectGitHubCredentials(env.GITHUB_CONNECTOR);

/**
 * Pushes a branch from the sandbox checkout, and nothing else.
 *
 * @remarks
 * This is the only tool that writes code anywhere, so the whole file is about
 * what it refuses.
 *
 * The credential never enters the sandbox. `git` runs against a token-free URL
 * and the platform rewrites the Authorization header on egress to github.com,
 * which is the same shape the channel's own checkout uses. A token passed
 * through the environment or the command line would be readable by anything
 * the model chose to run next.
 *
 * The remote is built from the repository name rather than read from git
 * config, because config inside the sandbox is model-writable: `pushurl`, a
 * per-branch remote or `pushDefault` could otherwise redirect a brokered
 * credential somewhere it was never meant to go.
 *
 * Both the branch and the repository are validated before either reaches the
 * command line, and the repository has to be one the agent was configured to
 * follow. The policy is dropped in a `finally`, so a failed push does not
 * leave the credential attached to the session's egress.
 *
 * The tool is withheld entirely from unattended turns. A triage session is
 * driven by text a stranger wrote, and nothing downstream of that gets to
 * push code.
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (isAutonomous(ctx.session.auth.current)) {
        return null;
      }
      return {
        git_push: defineTool({
          description:
            "Push a branch from the sandbox checkout to GitHub. The branch must already exist locally with the work committed and the repository's own checks run. Pushes to main and master are refused, and the repository must be one this agent follows. After a successful push, open the pull request with github__createPullRequest.",
          async execute({ branch, repo }, toolCtx) {
            const repoRefusal = validatePushRepo(repo, env.DIGEST_REPOS);
            if (repoRefusal) {
              return { error: repoRefusal, success: false };
            }
            const branchRefusal = validatePushBranch(branch);
            if (branchRefusal) {
              return { error: branchRefusal, success: false };
            }
            const sandbox = await toolCtx.getSandbox();
            const token = credentials.installationToken;
            if (token === undefined) {
              return {
                error: "The GitHub connector exposes no installation token.",
                success: false,
              };
            }
            const resolved =
              typeof token === "function" ? await token() : token;
            await sandbox.setNetworkPolicy(pushBrokerPolicy(resolved));
            try {
              const push = await sandbox.run({
                command: `git push ${pushUrl(repo)} 'refs/heads/${branch}:refs/heads/${branch}'`,
              });
              if (push.exitCode !== 0) {
                return {
                  error: `git push exited ${push.exitCode}: ${String(push.stderr ?? "").slice(0, 400)}`,
                  success: false,
                };
              }
              return { branch, repo, success: true };
            } finally {
              // Never leave the brokered credential attached to this session.
              await sandbox.setNetworkPolicy("allow-all");
            }
          },
          inputSchema: z.object({
            branch: z
              .string()
              .min(1)
              .describe(
                "Branch in the sandbox checkout to push, e.g. fix/digest-empty-state"
              ),
            repo: z
              .string()
              .min(1)
              .describe("Target repository as owner/repo, e.g. acme/widgets"),
          }),
          outputSchema: z.object({
            branch: z.string().optional(),
            error: z.string().optional(),
            repo: z.string().optional(),
            success: z.boolean(),
          }),
        }),
      };
    },
  },
});
