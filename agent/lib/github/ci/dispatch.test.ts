import type {
  GitHubCheckRunEvent,
  GitHubWorkflowRunEvent,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import { startChase } from "#lib/github/ci/dispatch";
import type { CiInput } from "#lib/github/ci/dispatch";
import {
  actionsLog,
  BASE,
  FILES_PATH,
  HEAD,
  JOBS_PATH,
  OWNER,
  PULL_PATH,
  REPO,
  RUN_PATH,
  fakeGitHub,
  logPath,
} from "#lib/github/ci/fixtures";
import type { GitHubAnswer, GitHubAnswers } from "#lib/github/ci/fixtures";
import { createChaseLedger } from "#lib/github/ci/ledger";
import { readCiTurn } from "#lib/github/ci/turn";
import { classifyPrincipal } from "#lib/trust";

const authBase: SessionAuthContext = {
  attributes: {
    pull_request_number: "7",
    repository: `${OWNER}/${REPO}`,
    user_login: OWNER,
  },
  authenticator: "github-webhook",
  issuer: `github:${OWNER}`,
  principalId: "github:10858",
  principalType: "user",
  subject: OWNER,
};

const workflowPayload = (
  overrides: Partial<GitHubWorkflowRunEvent> = {}
): GitHubWorkflowRunEvent => ({
  action: "completed",
  app: { slug: "github-actions" },
  conclusion: "failure",
  headSha: HEAD,
  pullRequests: [7],
  raw: { id: 77, name: "CI", run_attempt: 1 },
  status: "completed",
  workflowRunId: 77,
  ...overrides,
});

const workflow = (overrides?: Partial<GitHubWorkflowRunEvent>): CiInput => ({
  kind: "workflow_run",
  payload: workflowPayload(overrides),
});

const external = (overrides: Partial<GitHubCheckRunEvent> = {}): CiInput => ({
  kind: "check_run",
  payload: {
    action: "completed",
    app: { slug: "gitguardian" },
    checkRunId: 5,
    conclusion: "failure",
    headSha: HEAD,
    pullRequests: [7],
    raw: {
      name: "GitGuardian Security Checks",
      output: { summary: "1 secret incident found" },
    },
    status: "completed",
    ...overrides,
  },
});

const openPullRequest = {
  draft: false,
  head: { sha: HEAD },
  state: "open",
  title: "feat: a thing",
  user: { login: OWNER, type: "User" },
} satisfies GitHubAnswer;

/** A GitHub whose run failed in `src/server.ts`, a file the pull request changed. */
const failingRepository = (
  pullRequest: GitHubAnswer = openPullRequest
): GitHubAnswers => ({
  [FILES_PATH]: [{ filename: "src/server.ts" }],
  [JOBS_PATH]: { jobs: [{ conclusion: "failure", id: 2, name: "test" }] },
  [PULL_PATH]: pullRequest,
  [RUN_PATH]: { conclusion: "failure", run_attempt: 1 },
  [logPath(2)]: actionsLog("FAIL src/server.test.ts", "AssertionError: no"),
});

const chase = async (
  ci: CiInput,
  answers: GitHubAnswers,
  ledger = createChaseLedger()
) => {
  const logs: string[] = [];
  const { asked, request } = fakeGitHub(answers);
  const result = await startChase(
    { authBase, ci, owner: OWNER, repo: REPO },
    { ledger, log: (line) => logs.push(line), request }
  );
  return { asked, logs, result };
};

describe("a red workflow run on the maintainer's open pull request", () => {
  it("starts a turn as the app, anchored to the pull request", async () => {
    const { result } = await chase(workflow(), failingRepository());
    expect(classifyPrincipal(result?.auth ?? null)).toBe("app");
    expect(result?.auth?.attributes.pull_request_number).toBe("7");
    expect(result?.title).toBe("CI chase: PunGrumpy/baymi#7 CI");
  });

  it("carries the classification to the end of the turn and into its brief", async () => {
    const { result } = await chase(workflow(), failingRepository());
    expect(readCiTurn(result?.auth ?? null)).toMatchObject({
      attempt: 1,
      headSha: HEAD,
      job: "test",
      kind: "own-code",
      runId: 77,
    });
    expect(result?.context?.[0]).toContain("own-code (in-diff)");
  });

  it("asks for the one rerun when the failure is a flake", async () => {
    const { result } = await chase(workflow(), {
      ...failingRepository(),
      [logPath(2)]: actionsLog("Error: connect ECONNRESET 1.2.3.4:443"),
    });
    expect(result?.context?.[0]).toContain(
      "Call `github__rerunWorkflowRun` once"
    );
  });
});

describe("what starts nothing", () => {
  it("skips an event the filter rejects, before it reads anything", async () => {
    const { asked, logs, result } = await chase(
      workflow({ conclusion: "success" }),
      failingRepository()
    );
    expect(result).toBeNull();
    expect(asked).toStrictEqual([]);
    expect(logs).toStrictEqual([
      "ci skip workflow_run PunGrumpy/baymi: not-red",
    ]);
  });

  it.each([
    ["closed", { state: "closed" }],
    ["draft", { draft: true }],
    ["head-moved", { head: { sha: "f".repeat(40) } }],
    ["not-the-maintainers", { user: { login: "eve", type: "User" } }],
  ] as const)("skips a pull request that is %s", async (why, change) => {
    const { logs, result } = await chase(
      workflow(),
      failingRepository({ ...openPullRequest, ...change })
    );
    expect(result).toBeNull();
    expect(logs.at(-1)).toContain(why);
  });

  it("skips a pull request it cannot read", async () => {
    const { logs, result } = await chase(workflow(), {});
    expect(result).toBeNull();
    expect(logs.at(-1)).toContain("pull request unread");
  });

  it("starts one turn for one run and attempt, however often it is announced", async () => {
    const ledger = createChaseLedger();
    const first = await chase(workflow(), failingRepository(), ledger);
    const again = await chase(workflow(), failingRepository(), ledger);
    expect(first.result).not.toBeNull();
    expect(again.result).toBeNull();
    expect(again.logs.at(-1)).toContain("already chased");
  });

  it("chases attempt 2 of a run it already chased at attempt 1", async () => {
    const ledger = createChaseLedger();
    await chase(workflow(), failingRepository(), ledger);
    const second = await chase(
      workflow({ raw: { id: 77, name: "CI", run_attempt: 2 } }),
      failingRepository(),
      ledger
    );
    expect(second.result).not.toBeNull();
  });

  it("skips a cancelled run whose log shows no timeout: a newer push superseded it", async () => {
    const { logs, result } = await chase(
      workflow({ conclusion: "cancelled" }),
      {
        ...failingRepository(),
        [logPath(2)]: actionsLog("Error: The operation was canceled."),
      }
    );
    expect(result).toBeNull();
    expect(logs.at(-1)).toContain("cancelled, not a timeout");
  });

  it("skips an event whose run has since passed", async () => {
    const { logs, result } = await chase(workflow(), {
      ...failingRepository(),
      [RUN_PATH]: { conclusion: "success", run_attempt: 2 },
    });
    expect(result).toBeNull();
    expect(logs.at(-1)).toContain("is success now");
  });

  it("chases a cancelled run whose log shows it ran out of time", async () => {
    const { result } = await chase(workflow({ conclusion: "cancelled" }), {
      ...failingRepository(),
      [logPath(2)]: actionsLog(
        "##[error]The job running on runner X has exceeded the maximum execution time of 360 minutes."
      ),
    });
    expect(result).not.toBeNull();
  });
});

describe("a red check from another app", () => {
  it("starts a turn that reads nothing from Actions and never asks for a rerun", async () => {
    const { asked, result } = await chase(external(), {
      [PULL_PATH]: openPullRequest,
    });
    expect(asked).toStrictEqual([`${BASE}/pulls/7`]);
    expect(readCiTurn(result?.auth ?? null)).toMatchObject({
      kind: "external",
      runId: null,
    });
    expect(result?.context?.[0]).toContain("Do not rerun anything");
  });

  it.each(["baymiai", "github-actions"])(
    "skips a check run from %s",
    async (slug) => {
      const { result } = await chase(external({ app: { slug } }), {
        [PULL_PATH]: openPullRequest,
      });
      expect(result).toBeNull();
    }
  );
});
