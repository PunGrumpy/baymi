import { defineWorkflowTool } from "eve/tools";
import type { WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";

import { createMemoryBudgetStore } from "#lib/chase/budget";
import { githubSend } from "#lib/chase/commit";
import {
  admitChase,
  chaseApproval,
  chaseMessage,
  hasModelKey,
} from "#lib/chase/gate";
import type { Admission, ChaseRequest, ChaseTask } from "#lib/chase/gate";
import {
  CHASE_RESULT,
  CHASE_RESULT_JSON_SCHEMA,
  lostResult,
  witnessResult,
} from "#lib/chase/result";
import type { ChaseResult } from "#lib/chase/result";
import { env } from "#lib/env";
import { mintInstallationToken } from "#lib/github/credentials";
import { REPOSITORY_PATTERN } from "#lib/github/dependencies";

const DESCRIPTION =
  "Hand one pull request whose own code fails its checks to the chase, which reproduces the failure in its own sandbox, makes the smallest fix, runs the checks, and pushes atomic commits to the pull request's branch, or opens a pull request against it when it cannot push. " +
  "It never merges, rebases or force-pushes. It answers with the result: pushed, opened a pull request, or why it stopped. " +
  "Call it once, for the pull request this conversation is about: it refuses any other, and a conversation that is not about a pull request. At most three run a day and one per head.";

/**
 * Today's chases, in this runtime's memory; `docs/notes.md` says why here.
 */
const ledger = createMemoryBudgetStore();

/** Who, which pull request, which head, and the budget, in the app runtime. */
// oxlint-disable-next-line eslint/func-style -- eve marks a step only on an async function declaration
async function admit(
  ctx: WorkflowStepToolContext,
  request: ChaseRequest
): Promise<Admission> {
  "use step";
  return admitChase(ctx.session.auth.current, request, {
    hasModelKey: hasModelKey(process.env),
    now: Date.now(),
    send: githubSend(await mintInstallationToken()),
    store: ledger,
    trust: { slackTeamId: env.SLACK_TEAM_ID },
  });
}

const PULL_HEAD = z.object({ head: z.object({ sha: z.string() }) });

/** The subagent's answer, checked against the pull request's head on GitHub. */
// oxlint-disable-next-line eslint/func-style -- eve marks a step only on an async function declaration
async function witness(
  task: ChaseTask,
  claimed: ChaseResult
): Promise<ChaseResult> {
  "use step";
  if (claimed.status !== "pushed") {
    return claimed;
  }
  const read = await githubSend(await mintInstallationToken())(
    `/repos/${task.repository}/pulls/${task.pullRequest}`,
    { method: "GET" }
  );
  return witnessResult(
    claimed,
    PULL_HEAD.safeParse(read.body).data?.head.sha ?? null
  );
}

/**
 * The one way into the `chase` subagent, and the gate in front of it.
 *
 * @remarks
 * The subagent is static with `tool: false`, because eve 0.62.0 refuses a
 * direct model from a dynamic subagent, and only a workflow tool can call a
 * hidden subagent by name. Workflow tools are static, so the gate is not the
 * tool's presence but its approval policy and its first step: the policy
 * refuses every class but the app and the maintainer before the tool runs
 * (`chaseApproval`), and `admitChase` checks them again with the pull request,
 * the head, the model key and the day's budget, all in the app runtime. The
 * subagent's own first tool checks the class a third time.
 *
 * The answer comes back as the subagent's structured output, built by its
 * tools from what they recorded, and a push is believed only when GitHub
 * shows it as the head. The CI turn's channel reads the result off the
 * tool's `action.result` and renders the Slack line.
 */
export default defineWorkflowTool({
  approval: (ctx) =>
    chaseApproval(ctx.session.auth.current, {
      slackTeamId: env.SLACK_TEAM_ID,
    }),
  description: DESCRIPTION,
  async execute(input, ctx) {
    "use workflow";
    const admission = await admit(ctx, input);
    if (!admission.ok) {
      return admission.result;
    }
    const { task } = admission;
    let answer: ChaseResult | undefined;
    try {
      answer = CHASE_RESULT.safeParse(
        await ctx.agent("chase", {
          message: chaseMessage(task),
          outputSchema: CHASE_RESULT_JSON_SCHEMA,
        })
      ).data;
    } catch (error) {
      return lostResult({
        headSha: task.headSha,
        pullRequest: task.url,
        why: `The chase session failed: ${String(error)}`,
      });
    }
    if (answer === undefined) {
      return lostResult({
        headSha: task.headSha,
        pullRequest: task.url,
        why: "The chase answered without a result.",
      });
    }
    return await witness(task, answer);
  },
  inputSchema: z.object({
    failure: z
      .string()
      .max(2000)
      .describe(
        "What failed: the check and its error line, or what the maintainer reported."
      ),
    pullRequest: z.number().int().positive(),
    repository: z
      .string()
      .regex(REPOSITORY_PATTERN)
      .describe("The repository as owner/name."),
  }),
});
