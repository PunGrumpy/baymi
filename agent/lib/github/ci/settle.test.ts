import { describe, expect, it } from "vitest";

import { sendLineOnce } from "#lib/github/ci/deliver";
import {
  fakeGitHub,
  fakeSlackChannel,
  HEAD,
  OWNER,
  REPO,
  RUN_PATH,
} from "#lib/github/ci/fixtures";
import type { GitHubAnswers } from "#lib/github/ci/fixtures";
import { createChaseLedger } from "#lib/github/ci/ledger";
import { rerunTriggered, settleChase } from "#lib/github/ci/settle";
import type { SettleDeps } from "#lib/github/ci/settle";
import type { CiTurn } from "#lib/github/ci/turn";
import type { FetchLike, SlackMessagePayload } from "#lib/slack/notify";

const pullRequest = {
  number: 7,
  repository: `${OWNER}/${REPO}`,
  url: `https://github.com/${OWNER}/${REPO}/pull/7`,
};

const turn = (overrides: Partial<CiTurn> = {}): CiTurn => ({
  attempt: 1,
  conclusion: "failure",
  evidence: "Error: connect ECONNRESET",
  headSha: HEAD,
  job: "test",
  key: "pungrumpy/baymi#run77@1",
  kind: "flake",
  reason: "network",
  runId: 77,
  ...overrides,
});

const harness = (answers: GitHubAnswers, delivered = true) => {
  const sent: SlackMessagePayload[] = [];
  const github = fakeGitHub(answers);
  const deps: SettleDeps = {
    ledger: createChaseLedger(),
    request: github.request,
    send: (message) => {
      sent.push(message);
      return Promise.resolve(
        delivered
          ? { status: "delivered" }
          : { error: "channel_not_found", status: "unsent" }
      );
    },
  };
  return { deps, sent };
};

const settle = (
  deps: SettleDeps,
  change: Partial<CiTurn> = {},
  rerunAccepted = false
) =>
  settleChase(deps, {
    owner: OWNER,
    pullRequest,
    repo: REPO,
    rerunAccepted,
    turn: turn(change),
  });

const target = (runId: number | null) => ({
  owner: OWNER,
  repo: REPO,
  turn: { attempt: 1, runId },
});

describe(rerunTriggered, () => {
  it("sees the rerun GitHub accepted: the run is on a later attempt", async () => {
    const { request } = fakeGitHub({ [RUN_PATH]: { run_attempt: 2 } });
    await expect(rerunTriggered(request, target(77))).resolves.toBeTruthy();
  });

  it("sees no rerun while the run is still on the attempt that failed", async () => {
    const { request } = fakeGitHub({ [RUN_PATH]: { run_attempt: 1 } });
    await expect(rerunTriggered(request, target(77))).resolves.toBeFalsy();
  });

  it("counts a run it cannot read as not rerun", async () => {
    const { request } = fakeGitHub({});
    await expect(rerunTriggered(request, target(77))).resolves.toBeFalsy();
  });

  it("counts an external check, which has no run, as not rerun", async () => {
    const { asked, request } = fakeGitHub({});
    await expect(rerunTriggered(request, target(null))).resolves.toBeFalsy();
    expect(asked).toStrictEqual([]);
  });
});

describe(settleChase, () => {
  it("says nothing when the flake was rerun", async () => {
    const { deps, sent } = harness({ [RUN_PATH]: { run_attempt: 2 } });
    await expect(settle(deps)).resolves.toStrictEqual({
      reason: "quiet",
      said: false,
    });
    expect(sent).toStrictEqual([]);
  });

  it("takes the turn's own successful rerun call as the rerun, before GitHub reports it", async () => {
    const { deps, sent } = harness({ [RUN_PATH]: { run_attempt: 1 } });
    await expect(settle(deps, {}, true)).resolves.toStrictEqual({
      reason: "quiet",
      said: false,
    });
    expect(sent).toStrictEqual([]);
  });

  it("says so when the flake was not rerun", async () => {
    const { deps, sent } = harness({ [RUN_PATH]: { run_attempt: 1 } });
    await expect(settle(deps)).resolves.toStrictEqual({
      delivered: true,
      reason: "rerun-not-done",
      said: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text.startsWith(pullRequest.url)).toBeTruthy();
  });

  it("says it once, however often the turn is delivered", async () => {
    const { deps, sent } = harness({ [RUN_PATH]: { run_attempt: 1 } });
    await settle(deps);
    await expect(settle(deps)).resolves.toStrictEqual({
      reason: "duplicate",
      said: false,
    });
    expect(sent).toHaveLength(1);
  });

  it("says a second failure after the rerun, without reading the run", async () => {
    const { deps, sent } = harness({});
    await expect(settle(deps, { attempt: 2 })).resolves.toMatchObject({
      reason: "second-failure",
      said: true,
    });
    expect(sent[0]?.text).toContain("ไม่ใช่ flake");
  });

  it("says the diff's own code without a rerun in sight", async () => {
    const { deps } = harness({});
    await expect(settle(deps, { kind: "own-code" })).resolves.toMatchObject({
      reason: "own-code",
    });
  });

  it("says a stale base needs a rebase", async () => {
    const { deps, sent } = harness({});
    await expect(settle(deps, { kind: "stale-base" })).resolves.toMatchObject({
      reason: "stale-base",
    });
    expect(sent[0]?.text).toContain("rebase");
  });

  it("reports an undelivered line as undelivered", async () => {
    const { deps } = harness({}, false);
    await expect(settle(deps, { kind: "own-code" })).resolves.toStrictEqual({
      delivered: false,
      reason: "own-code",
      said: true,
    });
  });

  it("says an external check once per check", async () => {
    const { deps, sent } = harness({});
    const change = { kind: "external" as const, runId: null };
    await settle(deps, change);
    await settle(deps, change);
    expect(sent).toHaveLength(1);
  });
});

/** One instance: its own ledger, the same GitHub and the same Slack channel as every other. */
const instance = (fetchImpl: FetchLike): SettleDeps => ({
  ledger: createChaseLedger(),
  request: fakeGitHub({ [RUN_PATH]: { run_attempt: 1 } }).request,
  send: (message, key) =>
    sendLineOnce({
      fetchImpl,
      key,
      now: new Date("2026-10-23T02:00:00Z"),
      target: "C0123456789",
      text: message.text,
      token: "xoxb-test",
    }),
});

describe("a line said across instances", () => {
  it("says nothing the second time when a cold instance settles a redelivered chase", async () => {
    const slack = fakeSlackChannel();
    await expect(
      settle(instance(slack.fetchImpl), { kind: "own-code" })
    ).resolves.toMatchObject({ delivered: true, said: true });
    await expect(
      settle(instance(slack.fetchImpl), { kind: "own-code" })
    ).resolves.toStrictEqual({ reason: "duplicate", said: false });
    expect(slack.posted).toHaveLength(1);
  });

  it("posts nothing when Slack's history cannot be read", async () => {
    const slack = fakeSlackChannel("unreadable");
    await expect(
      settle(instance(slack.fetchImpl), { kind: "own-code" })
    ).resolves.toMatchObject({ delivered: false, said: true });
    expect(slack.posted).toStrictEqual([]);
  });
});
