import type { GitHubInstallationToken } from "eve/channels/github";
import type { SandboxNetworkPolicy } from "eve/sandbox";

const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(["main", "master"]);

/**
 * A conservative subset of the branch names git accepts: alphanumeric segments
 * joined by `.`, `_`, `-` or `/`.
 *
 * @remarks
 * The branch name is interpolated into a shell command, and the string comes
 * from the model, which in a triage session is downstream of text a stranger
 * wrote. Everything outside this set is refused rather than escaped, because a
 * refusal is easy to reason about and an escaping scheme is not.
 */
const BRANCH_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u;

/** `owner/repo`, the only shape the push target is allowed to take. */
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u;

/** The refusal reason, or null when the branch may be pushed. */
export const validatePushBranch = (branch: string): string | null => {
  if (
    !BRANCH_PATTERN.test(branch) ||
    branch.includes("..") ||
    branch.includes("//")
  ) {
    return `"${branch}" is not a valid branch name.`;
  }
  // `refs/heads/main` and `HEAD` reach a protected branch under another name,
  // so only plain branch names get through.
  if (branch.startsWith("refs/") || branch === "HEAD") {
    return `"${branch}" is not a plain branch name. Pass the branch without a refs/ prefix.`;
  }
  if (PROTECTED_BRANCHES.has(branch)) {
    return `Direct pushes to ${branch} are not allowed. Push a branch and open a pull request.`;
  }
  return null;
};

/**
 * The refusal reason, or null when this repository may be pushed to.
 *
 * @remarks
 * The agent may only push to the repositories it was configured to follow.
 * Anything else is a repository nobody asked it to touch, and the check lives
 * here rather than in the tool so it can be tested without a sandbox.
 */
export const validatePushRepo = (
  repo: string,
  allowed: readonly string[]
): string | null => {
  if (!REPO_PATTERN.test(repo)) {
    return `"${repo}" is not an owner/repo.`;
  }
  const match = allowed.some(
    (entry) => entry.toLowerCase() === repo.toLowerCase()
  );
  return match
    ? null
    : `${repo} is not one of the repositories this agent follows (${allowed.join(", ")}).`;
};

/**
 * Firewall policy that attaches the installation token to github.com egress
 * and nothing else.
 *
 * @remarks
 * This is how the credential reaches git without reaching the sandbox: the
 * process runs `git push` against a token-free URL and the platform rewrites
 * the header on the way out. A token placed in the environment or the command
 * line instead would be readable by anything the model chooses to run.
 */
export const pushBrokerPolicy = (installationToken: string) => {
  const authorization = `Basic ${Buffer.from(`x-access-token:${installationToken}`).toString("base64")}`;
  // `satisfies` rather than an annotation: the caller needs a
  // `SandboxNetworkPolicy` and the test needs to read the host it wrote, and
  // the policy type is a union wide enough to lose both.
  return {
    allow: {
      "*": [],
      "github.com": [
        { transform: [{ headers: { Authorization: authorization } }] },
      ],
    },
  } satisfies SandboxNetworkPolicy;
};

/** The remote a push is sent to, built from the repo rather than from git config. */
export const pushUrl = (repo: string): string =>
  `https://github.com/${repo}.git`;

/**
 * The installation token as a string, whichever form the credential took.
 *
 * @remarks
 * eve types the token as `string | (() => string | Promise<string>)` so that
 * an integration can defer minting it, and Connect uses the deferred form. The
 * union carries no tag, so the runtime type is the only thing that tells the
 * two apart.
 */
export const resolveInstallationToken = async (
  token: GitHubInstallationToken
): Promise<string> =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- untagged SDK union
  typeof token === "function" ? await token() : token;
