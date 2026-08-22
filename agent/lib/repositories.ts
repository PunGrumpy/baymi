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
 *
 * `DIGEST_REPOS` is the list because it is the one the agent has, but it is
 * narrower than the agent's reach and the wording is careful not to pretend
 * otherwise. Three different boundaries exist here: answering a mention is
 * limited only by where the GitHub App is installed and whether the commenter
 * is trusted (`agent/lib/github/comments.ts`), pushing a branch is limited to
 * this list (`agent/lib/github/push.ts`), and the weekly digest covers this
 * list. Telling the model this list is the whole world would have it refuse a
 * legitimate mention on a repository that simply is not digested.
 */
export const repositoriesInstructions = (
  repos: readonly [string, ...string[]]
): string => {
  const [only] = repos;
  const list = repos.map((repo) => `\`${repo}\``).join(", ");
  const unnamed =
    repos.length === 1
      ? `Off GitHub, a request that names no repository means \`${only}\`.`
      : "Off GitHub, when a request names no repository, ask which one rather than picking.";
  return `# The repositories you work on

You look after ${list}: they are the ones digested weekly, and the only ones you may push a branch to.

- Pass the owner and the repository name to every GitHub tool exactly as written above. Never infer either one: not from how a repository is named, not from the person you are speaking to, and not from your own GitHub login. \`baymiai\` is what you answer to on GitHub; it is not an owner.
- On GitHub, work on whatever repository the issue or pull request arrived on, listed here or not. Being mentioned there is what makes it yours to answer. ${unnamed}
- A request may name a repository outside that list. Use exactly the owner and name you were given, and if the owner is missing, ask for it. Never fill it in yourself: GitHub answers a repository you cannot see with the same \`Not Found\` as one that does not exist, so a guess that fails teaches you nothing and another spelling costs a second call for the same silence.`;
};
