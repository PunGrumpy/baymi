import type { AgentModelOptionsDefinition } from "eve";
import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

/**
 * The chase's model: Claude Sonnet 5.5, on Anthropic directly, by its native
 * id with dashes.
 *
 * @remarks
 * Its work is a loop of shell commands, edits and check runs whose verdict
 * comes from `run_checks`, not from its opinion, so it does not need the
 * lead's judgment, and Sonnet costs about half of Opus per token. It is
 * declared here rather than in `#lib/model`, which unit M1 owns; the two
 * meet when M1 lands. eve 0.62.0 accepts a provider object only from a
 * static agent, which is why this subagent is static and the `chase_pull_request` tool
 * gates it (`docs/notes.md`).
 */
export const CHASE_MODEL_ID = "claude-sonnet-5-5";

/**
 * Sonnet 5.5's input window, from `max_input_tokens` on Anthropic's
 * `/v1/models`. eve reads a model's window from the AI Gateway catalog,
 * which has no entry for a direct model.
 */
const CONTEXT_WINDOW_TOKENS = 1_000_000;

/**
 * Anthropic's own effort setting. With a provider effort set, eve's
 * `reasoning` is skipped by the bundled provider, so the agent sets only this.
 */
const MODEL_OPTIONS = {
  providerOptions: { anthropic: { effort: "high" } },
} satisfies AgentModelOptionsDefinition;

/**
 * The chase subagent: takes one pull request whose own code failed its
 * checks to green, in a sandbox of its own.
 *
 * @remarks
 * A declared subagent inherits nothing from the root: it has only the tools,
 * instructions and sandbox under this directory. It has a shell in a sandbox
 * that reaches the npm registries and nothing else, no GitHub tools, and no
 * connection; its own tools hold the installation token in the app runtime,
 * read the pull request from GitHub, and push the result.
 *
 * `tool: false` keeps it out of the root model's tools. The only way in is
 * the root's `chase_pull_request` tool, which decides who may start one, on which pull
 * request, and whether the day's budget allows it, before it calls this
 * subagent by name. It needs `ANTHROPIC_API_KEY` in the server environment;
 * the `chase_pull_request` tool refuses without it.
 */
export default defineAgent({
  defaultTools: false,
  description:
    "Take one pull request whose own code failed its checks to green: reproduce the failure, make the smallest fix, run the checks, and push.",
  limits: { maxOutputTokensPerSession: 150_000 },
  model: anthropic(CHASE_MODEL_ID),
  modelContextWindowTokens: CONTEXT_WINDOW_TOKENS,
  modelOptions: MODEL_OPTIONS,
  tool: false,
});
