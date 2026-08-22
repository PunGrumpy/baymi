/**
 * The system-prompt section naming the repositories the agent maintains.
 *
 * @remarks
 * This exists because of a failure that reached production: on 2026-08-22 two
 * Slack sessions opened with `github__getRepository` and both returned `Not
 * Found`, one of them twice in a row. Nothing was broken. The agent had never
 * been told which repositories it works on, so it guessed an owner, and
 * `baymiai` (the login it answers to on GitHub, per `instructions.md`) is the
 * guess closest to hand. `PunGrumpy/baymi` resolves; `baymiai/baymi` returns
 * exactly the 404 that was recorded.
 *
 * `DIGEST_REPOS` already holds the list, but only the weekly digest and
 * `git_push`'s refusal ever read it, and neither is in the prompt. On GitHub
 * the repository is implied by the issue the mention arrived on, which is why
 * that channel never hit this; on Slack, Linear and the HTTP surface nothing
 * implies it.
 *
 * The mount site's `context` option would not have caught this. It fills owner
 * and repo only when the model omits them, and a 404 means a request was sent,
 * so the model supplied an owner and it was wrong.
 */
export const repositoriesInstructions = (
  repos: readonly [string, ...string[]]
): string => {
  const [only] = repos;
  const list = repos.map((repo) => `\`${repo}\``).join(", ");
  const unnamed =
    repos.length === 1
      ? `Everywhere else, a request that names no repository means \`${only}\`.`
      : "Everywhere else, when a request names no repository, ask which of them rather than picking one.";
  return `# The repositories you maintain

You work on ${list}. That is the whole list.

- Pass the owner and the repository name to every GitHub tool exactly as written above. Never infer either one: not from how a repository is named, not from the person you are speaking to, and not from your own GitHub login. \`baymiai\` is what you answer to there; it is not an owner.
- On GitHub the repository is the one the issue or pull request arrived on. ${unnamed}
- If a request names a repository that is not on that list, say so and stop. You cannot reach it, and GitHub answers a repository you cannot see with the same \`Not Found\` as one that does not exist, so trying another spelling tells you nothing and costs a call.`;
};
