import type { ChannelFrom, ChannelSendOptions } from "eve/channels";
import type { GitHubChannelState } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import { chaseAddress, routeAppTurns } from "#lib/github/ci/session";
import { chaseAuth } from "#lib/github/ci/turn";
import type { CiTurn } from "#lib/github/ci/turn";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

const PULL_REQUEST_ADDRESS = "repo:1:pull:7";

const turn: CiTurn = {
  attempt: 1,
  conclusion: "failure",
  evidence: "",
  headSha: "3c41196471a0ba382508ce887681b1403f1a47cd",
  job: "test",
  key: "pungrumpy/baymi#run77@1",
  kind: "own-code",
  reason: "in-diff",
  runId: 77,
};

const webhook: SessionAuthContext = {
  attributes: { pull_request_number: "7", repository: "PunGrumpy/baymi" },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:10858",
  principalType: "user",
  subject: "PunGrumpy",
};

const reviewer: SessionAuthContext = {
  ...webhook,
  principalId: REVIEWER_PRINCIPAL,
  principalType: "service",
};

const state: GitHubChannelState = {
  baseRef: null,
  baseSha: null,
  checkoutPath: null,
  conversationKind: "pull_request",
  defaultBranch: null,
  headRef: null,
  headSha: turn.headSha,
  installationId: 42,
  issueNumber: 7,
  owner: "PunGrumpy",
  pullRequestNumber: 7,
  repo: "baymi",
  repositoryId: 1,
  reviewCommentId: null,
  reviewThreadRootCommentId: null,
  triggeringCommentId: null,
  triggeringUserLogin: "PunGrumpy",
};

/** What the fake runtime answers every send with, once it has recorded it. */
const RECORDED = "recorded";

/** A `from` that records which address each send went to, and with what options, then refuses it. */
const recordingFrom = () => {
  const sent: {
    address: string;
    options: ChannelSendOptions<GitHubChannelState>;
  }[] = [];
  const from: ChannelFrom<GitHubChannelState> = (address) => ({
    cancel: () => Promise.reject(new Error("not used")),
    clear: () => Promise.reject(new Error("not used")),
    compact: () => Promise.reject(new Error("not used")),
    reset: () => Promise.reject(new Error("not used")),
    respond: () => Promise.reject(new Error("not used")),
    send(_message, options) {
      sent.push({ address, options });
      return Promise.reject(new Error(RECORDED));
    },
  });
  return { from, sent };
};

describe(routeAppTurns, () => {
  it("sends a chase to its own session in task mode", async () => {
    const { from, sent } = recordingFrom();
    await expect(
      routeAppTurns(from)(PULL_REQUEST_ADDRESS).send("Check run", {
        auth: chaseAuth(webhook, turn),
        state,
      })
    ).rejects.toThrow(RECORDED);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.address).toBe("repo:1:pull:7:ci:pungrumpy-baymi-run77-1");
    expect(sent[0]?.options.mode).toBe("task");
  });

  it("keeps a review, a mention and an unknown caller on the pull request's session, in its mode", async () => {
    for (const auth of [reviewer, webhook, null]) {
      const { from, sent } = recordingFrom();
      // oxlint-disable-next-line eslint/no-await-in-loop -- one caller at a time
      await expect(
        routeAppTurns(from)(PULL_REQUEST_ADDRESS).send("hi", { auth, state })
      ).rejects.toThrow(RECORDED);
      expect(sent).toStrictEqual([
        { address: PULL_REQUEST_ADDRESS, options: { auth, state } },
      ]);
    }
  });

  it("still runs an app turn with no chase facts in task mode", async () => {
    const { from, sent } = recordingFrom();
    const app: SessionAuthContext = {
      attributes: {},
      authenticator: "app",
      principalId: "eve:app",
      principalType: "runtime",
    };
    await expect(
      routeAppTurns(from)(PULL_REQUEST_ADDRESS).send("x", { auth: app, state })
    ).rejects.toThrow(RECORDED);
    expect(sent[0]).toMatchObject({
      address: PULL_REQUEST_ADDRESS,
      options: { mode: "task" },
    });
  });

  it("gives two attempts of one run, and two runs, different sessions", () => {
    const addresses = new Set(
      [
        "pungrumpy/baymi#run77@1",
        "pungrumpy/baymi#run77@2",
        "pungrumpy/baymi#run78@1",
        "pungrumpy/baymi#check5",
      ].map((key) => chaseAddress(PULL_REQUEST_ADDRESS, key))
    );
    expect(addresses.size).toBe(4);
  });
});
