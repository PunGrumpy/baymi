import { defineEval } from "eve/evals";

const MENTION_ON_A_PULL_REQUEST = [
  "You were mentioned on pull request #10 of the digest repository, on its thread: `@baymiai can you summarize this for the reviewers?`",
  "Answer with what the PR does, a table of the changed files, and where to start reading.",
  "The diff adds a bootstrap hook to `agent/sandbox.ts` that marks `/workspace` as a git safe directory, and documents the failure it fixes in `docs/notes.md`.",
].join("\n\n");

export default defineEval({
  description:
    "Writes a GitHub comment as its reply rather than posting one with a tool.",
  tags: ["fast"],
  async test(t) {
    await t.send(MENTION_ON_A_PULL_REQUEST);
    // The channel posts the reply. A comment tool on the thread the session is
    // already on posts the same thing twice.
    t.notCalledTool("github__addPullRequestComment");
    t.notCalledTool("github__addIssueComment");
    t.judge.autoevals
      .closedQA(
        "The response is the answer itself, written to the thread. It does not say that it posted a comment, that it will post one, or that it drafted one for approval."
      )
      .atLeast(0.7)
      .soft();
  },
});
