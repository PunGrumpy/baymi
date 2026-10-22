import { z } from "zod";

import type { FetchLike } from "#lib/github/installation";

/**
 * The guard on `rerunWorkflowRun`: a failed run is rerun once, and only while
 * it still describes the pull request.
 *
 * @remarks
 * A rerun is not idempotent: every call starts another attempt, and the tool
 * has no key to dedupe on. Queue delivery is at-least-once, so a turn that is
 * delivered twice would call it twice if the guard remembered the first call
 * anywhere this runtime could lose. So the attempt is read from GitHub on every
 * call. `run_attempt` is 1 for a run nobody has rerun and 2 as soon as GitHub
 * accepts the first rerun, which makes the duplicated call find an attempt it
 * refuses. The same read refuses a rerun of a run that is still going, one
 * that passed, and one for a commit the pull request has since moved past,
 * because rerunning that run would spend a runner on code nobody will merge.
 *
 * Anything the guard cannot read is a refusal. The decision is asked at the
 * moment the tool is called, so it is as fresh as the model's call is; two
 * calls racing each other before GitHub reports attempt 2 are not covered, and
 * `docs/notes.md` says so.
 */

const GITHUB_API = "https://api.github.com";

/** A run that ended badly enough to be worth a second try. */
export const RERUNNABLE_CONCLUSIONS = ["failure", "timed_out"] as const;

/** The first attempt is the only one Baymi reruns. */
const LAST_RERUNNABLE_ATTEMPT = 1;

const NAME = /^[\w.-]+$/u;

const RERUN_INPUT = z.object({
  owner: z.string().regex(NAME),
  repo: z.string().regex(NAME),
  runId: z.number().int().positive(),
});

/** Which run the model asked to rerun. */
export type RerunInput = z.infer<typeof RERUN_INPUT>;

/** The tool's input as the approval policy receives it: a record, or nothing. */
export const parseRerunInput = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- eve types an approval policy's tool input as a record of unknown, and this is where it is parsed
  toolInput?: Readonly<Record<string, unknown>>
): RerunInput | null => {
  const parsed = RERUN_INPUT.safeParse(toolInput);
  return parsed.success ? parsed.data : null;
};

const WORKFLOW_RUN = z.object({
  conclusion: z.string().nullable(),
  head_sha: z.string(),
  pull_requests: z.array(z.object({ number: z.number().int() })).default([]),
  run_attempt: z.number().int(),
  status: z.string(),
});

const PULL_REQUEST_HEAD = z.object({ head: z.object({ sha: z.string() }) });

/**
 * One GitHub REST read, parsed by the schema it is given, so no caller sees
 * a body it has not checked. A test supplies its own.
 */
export type ReadGitHub = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;

export type RerunVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): RerunVerdict => ({ ok: false, reason });

/**
 * Reads a GitHub REST path as JSON, and throws on any non-2xx.
 *
 * @remarks
 * The token is asked for on every read, inside the guard's own try block, so
 * a connector that cannot mint one is a refusal rather than a crashed step.
 */
export const githubReader =
  (getToken: () => Promise<string>, fetchImpl: FetchLike = fetch): ReadGitHub =>
  async (path, schema) => {
    const token = await getToken();
    const response = await fetchImpl(`${GITHUB_API}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for ${path}.`);
    }
    return schema.parse(await response.json());
  };

const runPath = ({ owner, repo, runId }: RerunInput): string =>
  `/repos/${owner}/${repo}/actions/runs/${runId}`;

/**
 * Whether Baymi may rerun this run now, decided from what GitHub reports now.
 *
 * @remarks
 * Refuses when the run is not finished, did not fail, is on an attempt after
 * the first, is attached to no open pull request, or ran a commit that is no
 * longer the head of a pull request it belongs to. GitHub lists only open
 * pull requests on a run, and none at all for a fork's, so a run on a merged
 * or closed pull request, a push to a branch and a fork's run are all refused
 * as attached to none rather than guessed at.
 */
export const checkRerun = async (
  input: RerunInput,
  read: ReadGitHub
): Promise<RerunVerdict> => {
  try {
    const run = await read(runPath(input), WORKFLOW_RUN);
    if (run.status !== "completed") {
      return refuse(
        `Run ${input.runId} is ${run.status}, not finished. Wait for it to settle before asking again.`
      );
    }
    if (
      !RERUNNABLE_CONCLUSIONS.some(
        (conclusion) => conclusion === run.conclusion
      )
    ) {
      return refuse(
        `Run ${input.runId} ended ${run.conclusion ?? "without a conclusion"}, so there is nothing to rerun.`
      );
    }
    if (run.run_attempt > LAST_RERUNNABLE_ATTEMPT) {
      return refuse(
        `Run ${input.runId} is already on attempt ${run.run_attempt}. A run is rerun once; report the failure instead.`
      );
    }
    if (run.pull_requests.length === 0) {
      return refuse(
        `Run ${input.runId} is attached to no open pull request, so its commit cannot be checked against a head. Leave it to the maintainer.`
      );
    }
    const heads = await Promise.all(
      run.pull_requests.map(async ({ number }) => {
        const pullRequest = await read(
          `/repos/${input.owner}/${input.repo}/pulls/${number}`,
          PULL_REQUEST_HEAD
        );
        return { number, sha: pullRequest.head.sha };
      })
    );
    const moved = heads.find(({ sha }) => sha !== run.head_sha);
    if (moved !== undefined) {
      return refuse(
        `Run ${input.runId} ran ${run.head_sha.slice(0, 7)}, but pull request #${moved.number} is at ${moved.sha.slice(0, 7)} now. Report on the current head instead.`
      );
    }
    return { ok: true };
  } catch (error) {
    return refuse(
      `GitHub could not confirm run ${input.runId} is safe to rerun (${String(error)}), so it was not rerun.`
    );
  }
};
