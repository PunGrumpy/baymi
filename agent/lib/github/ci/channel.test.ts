import type { GitHubChannelState } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { markFailedTurn } from "#lib/github/ci/route";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

/**
 * The GitHub channel's configuration and failure path, read off the module eve
 * loads.
 *
 * @remarks
 * `agent/channels/github.ts` is wiring and has no test of its own, but the
 * few settings that keep an app turn off the pull request are worth one: a
 * refactor that drops them would pass every test of the logic they protect.
 * The module validates `#lib/env` when it loads, so the variables it requires
 * are set to placeholders first, and `SLACK_NOTIFY_CHANNEL` is removed so no
 * path can reach Slack. Nothing here calls GitHub or Slack.
 *
 * `session.failed` is the one handler eve calls without a session context,
 * so the real handler is called directly, with a thread and a GitHub that
 * record what they were asked to do.
 */
const loadChannel = async () => {
  process.env.GITHUB_CONNECTOR ??= "github/test";
  process.env.GITHUB_WEBHOOK_SECRET ??= "placeholder";
  process.env.SLACK_CONNECTOR ??= "slack/test";
  delete process.env.SLACK_NOTIFY_CHANNEL;
  const module = await import("#channels/github");
  return module.default;
};

/**
 * The adapter is not part of eve's public channel type, so its handler is
 * parsed out of it. eve calls it with the event's data and the channel's
 * context, and no session.
 */
const ADAPTER = z.object({
  adapter: z.object({
    "session.failed": z.function({
      input: [z.unknown(), z.unknown()],
      output: z.unknown(),
    }),
  }),
});

const sessionFailed = async () =>
  ADAPTER.parse(await loadChannel()).adapter["session.failed"];

const app: SessionAuthContext = {
  attributes: { pull_request_number: "7", repository: "PunGrumpy/baymi" },
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

const maintainer: SessionAuthContext = {
  attributes: { user_login: "PunGrumpy" },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:10858",
  principalType: "user",
  subject: "PunGrumpy",
};

const channelState = (
  overrides: Partial<GitHubChannelState>
): GitHubChannelState => ({
  baseRef: "main",
  baseSha: null,
  checkoutPath: null,
  conversationKind: "pull_request",
  defaultBranch: "main",
  headRef: "feature",
  headSha: "3c41196471a0ba382508ce887681b1403f1a47cd",
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
  ...overrides,
});

const MENTION = { triggeringCommentId: 9 } as const;
const REVIEW = {} as const;

/** Fails the session the way eve would, and reports what reached the pull request. */
const failSession = async (
  state: GitHubChannelState,
  failedTurnBy: SessionAuthContext
) => {
  markFailedTurn(state, failedTurnBy);
  const post = vi.fn<(body: string) => Promise<void>>(() => Promise.resolve());
  const request = vi.fn<
    (input: { method: string; path: string }) => Promise<never>
  >(() => Promise.reject(new Error("GitHub is not reachable in a test")));
  const handler = await sessionFailed();
  // logFailure prints the failure; the test reads what reached GitHub instead.
  const quiet = vi.spyOn(console, "error").mockReturnValue();
  try {
    await handler(
      { code: "TURN_FAILED", message: "boom", sessionId: "wrun_1" },
      { github: { request }, state, thread: { post } }
    );
  } finally {
    quiet.mockRestore();
  }
  return { post, request };
};

describe("the GitHub channel", () => {
  it("queues a message that arrives during a turn instead of steering into it", async () => {
    const channel = await loadChannel();
    expect(channel.turnPolicy).toBe("queue");
  });

  it("posts no comment when an app turn dies in a session a mention opened", async () => {
    const { post, request } = await failSession(channelState(MENTION), app);
    expect(post).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("leaves the review's check run untouched when an app turn dies in a session a review opened", async () => {
    const { post, request } = await failSession(channelState(REVIEW), app);
    expect(request).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("still posts the notice, and still settles the review's check run, when a person's or the review's turn died", async () => {
    const mention = await failSession(channelState(MENTION), maintainer);
    expect(mention.post).toHaveBeenCalledOnce();

    const review = await failSession(channelState(REVIEW), {
      ...maintainer,
      principalId: REVIEWER_PRINCIPAL,
      principalType: "service",
    });
    expect(review.request).toHaveBeenCalledTimes(2);
    expect(review.post).not.toHaveBeenCalled();
  });
});
