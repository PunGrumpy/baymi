import { z } from "zod";

/**
 * What a chase came to, in one shape: the subagent answers with it, the tool
 * checks it against GitHub and returns it, and the CI turn renders it.
 *
 * @remarks
 * The subagent's tools build it from what they recorded, not from the
 * model's account: `push_fix` from the commits GitHub created, `stop_chase`
 * from the check runs. The model only carries it back. The gating tool then
 * reads the pull request's head, so a result that claims a push GitHub does
 * not show is turned into a failure before anyone reads it.
 */

export const CHASE_STATUSES = [
  "pushed",
  "opened-pull-request",
  "failed",
  "no-write-access",
  "not-reproduced",
  "partial",
  "refused",
  "superseded",
] as const;

export type ChaseStatus = (typeof CHASE_STATUSES)[number];

const CHECK = z.object({
  exitCode: z.number().int(),
  name: z.string(),
  passed: z.boolean(),
});

export const CHASE_RESULT = z.object({
  /** The branch the commits went to, or `null` when nothing was pushed. */
  branch: z.string().nullable(),
  /** Every check of the last run, and whether it passed. */
  checks: z.array(CHECK),
  /** The commits pushed, oldest first. */
  commits: z.array(z.string()),
  /** The pull request the fix was opened as, when the head could not be pushed to. */
  fixPullRequest: z.string().nullable(),
  /** The head the chase worked from. */
  headSha: z.string(),
  /** What was not verified, one line each; empty when the checks passed on the pushed change. */
  notVerified: z.array(z.string()),
  /** The end of the failing output, when the chase stopped on a failure. */
  output: z.string(),
  pullRequest: z.string(),
  /** One sentence: what happened, or why nothing did. */
  reason: z.string(),
  status: z.enum(CHASE_STATUSES),
});

export type ChaseResult = z.infer<typeof CHASE_RESULT>;

export type ChaseCheck = z.infer<typeof CHECK>;

const STRING = { type: "string" } as const;
const STRINGS = { items: STRING, type: "array" } as const;
const NULLABLE_STRING = { type: ["string", "null"] } as const;

/**
 * {@link CHASE_RESULT} as JSON Schema, for the subagent's structured answer.
 *
 * @remarks
 * Written out rather than generated, because eve takes a plain JSON object
 * and zod's generated schema is typed as something wider. The test keeps the
 * two in step: every field here is a field there.
 */
export const CHASE_RESULT_JSON_SCHEMA = {
  additionalProperties: false,
  properties: {
    branch: NULLABLE_STRING,
    checks: {
      items: {
        additionalProperties: false,
        properties: {
          exitCode: { type: "integer" },
          name: STRING,
          passed: { type: "boolean" },
        },
        required: ["exitCode", "name", "passed"],
        type: "object",
      },
      type: "array",
    },
    commits: STRINGS,
    fixPullRequest: NULLABLE_STRING,
    headSha: STRING,
    notVerified: STRINGS,
    output: STRING,
    pullRequest: STRING,
    reason: STRING,
    status: { enum: CHASE_STATUSES, type: "string" },
  },
  required: [
    "branch",
    "checks",
    "commits",
    "fixPullRequest",
    "headSha",
    "notVerified",
    "output",
    "pullRequest",
    "reason",
    "status",
  ],
  type: "object",
} as const;

/** Whether the pull request should go green without anyone: the fix is on its way. */
export const isFixed = (result: ChaseResult): boolean =>
  result.status === "pushed" || result.status === "opened-pull-request";

/** A chase that did not get as far as a sandbox. */
export const refusedResult = (input: {
  readonly headSha: string;
  readonly pullRequest: string;
  readonly reason: string;
  readonly status?: "no-write-access" | "refused" | "superseded";
}): ChaseResult => ({
  branch: null,
  checks: [],
  commits: [],
  fixPullRequest: null,
  headSha: input.headSha,
  notVerified: [],
  output: "",
  pullRequest: input.pullRequest,
  reason: input.reason,
  status: input.status ?? "refused",
});

/**
 * The result once checked against the pull request's head as GitHub shows it.
 *
 * @remarks
 * A push is believed only when the head is the last commit it names. Any
 * other claim is passed through: a result that says it failed costs a line
 * on Slack if it is wrong, and a fix pull request is a branch the maintainer
 * reads before merging.
 */
export const witnessResult = (
  claimed: ChaseResult,
  observedHead: string | null
): ChaseResult => {
  if (claimed.status !== "pushed") {
    return claimed;
  }
  const last = claimed.commits.at(-1);
  if (last !== undefined && observedHead === last) {
    return claimed;
  }
  return {
    ...claimed,
    notVerified: [
      ...claimed.notVerified,
      "GitHub does not show the push the chase reported.",
    ],
    reason: `The chase reported pushing ${last?.slice(0, 7) ?? "nothing"}, and the pull request's head is ${observedHead?.slice(0, 7) ?? "unknown"}.`,
    status: "failed",
  };
};

/** A chase whose subagent ended without a result the tool could read. */
export const lostResult = (input: {
  readonly headSha: string;
  readonly pullRequest: string;
  readonly why: string;
}): ChaseResult => ({
  ...refusedResult({
    headSha: input.headSha,
    pullRequest: input.pullRequest,
    reason: input.why,
  }),
  notVerified: [
    "The chase ended without a result, so nothing it did is known.",
  ],
  status: "failed",
});
