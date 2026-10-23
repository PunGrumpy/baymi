import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The GitHub channel's real handlers, driven through eve's own adapter wrapper.
 *
 * @remarks
 * `reply-path.test.ts` reads the channel as text and `channel.test.ts` calls
 * `session.failed` alone. Neither notices a wrong argument to the router, a
 * different write helper, or a failure mark applied to a copy of the state,
 * since each of those still reads as the right shape. This test runs the
 * handlers inside a fake eve context for an app turn in a session a mention,
 * a review and a chase opened, and asserts that nothing reaches the pull
 * request. It also pins the grounding ledger's key: a chase is the first turn
 * of a session of its own, so its `turn_0` must not ground a review's.
 */
import type { GitHubChannelState } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { chaseAuth } from "#lib/github/ci/turn";
import type { CiTurn } from "#lib/github/ci/turn";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

import { contextStorage } from "../../../../node_modules/eve/dist/src/context/container.js";

const noop = (): void => {};

const STORAGE = z.instanceof(AsyncLocalStorage);

/** eve's context, as far as the handlers read it: who is calling, and in which session. */
const within = async (
  auth: SessionAuthContext,
  run: () => Promise<void> | void,
  sessionId = "wrun_probe"
): Promise<void> => {
  const fake = {
    get: noop,
    has: () => false,
    require: () => ({
      auth: { current: auth },
      parent: undefined,
      sessionId,
      turn: undefined,
    }),
  };
  await STORAGE.parse(contextStorage).run(fake, async () => {
    await run();
  });
};

/** The adapter is not part of eve's public channel type, so its handlers are parsed out of it. */
const HANDLER = z.function({
  input: [z.unknown(), z.unknown(), z.unknown().optional()],
  output: z.custom<Promise<void> | void>(),
});
const HANDLERS = z.object({
  adapter: z.object({
    "action.result": HANDLER,
    "input.requested": HANDLER,
    "message.completed": HANDLER,
    "session.failed": HANDLER,
    "turn.completed": HANDLER,
    "turn.failed": HANDLER,
  }),
});
type Handlers = z.infer<typeof HANDLERS>["adapter"];

const load = async (): Promise<Handlers> => {
  process.env.GITHUB_CONNECTOR ??= "github/test";
  process.env.GITHUB_WEBHOOK_SECRET ??= "placeholder";
  process.env.SLACK_CONNECTOR ??= "slack/test";
  delete process.env.SLACK_NOTIFY_CHANNEL;
  const mod = await import("#channels/github");
  return HANDLERS.parse(mod.default).adapter;
};

const FAILED_TURN = z.object({ baymiFailedTurn: z.string().optional() });

const turn: CiTurn = {
  attempt: 1,
  conclusion: "failure",
  evidence: "x",
  headSha: "a".repeat(40),
  job: "test",
  key: "pungrumpy/baymi#run77@1",
  kind: "own-code",
  reason: "in-diff",
  runId: 77,
};
const base: SessionAuthContext = {
  attributes: { pull_request_number: "7", repository: "PunGrumpy/baymi" },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:10858",
  principalType: "user",
  subject: "PunGrumpy",
};
const app = chaseAuth(base, turn);
const person = base;
const reviewer: SessionAuthContext = {
  ...base,
  principalId: REVIEWER_PRINCIPAL,
  principalType: "service",
};

const state = (o: Partial<GitHubChannelState>): GitHubChannelState => ({
  baseRef: "main",
  baseSha: null,
  checkoutPath: null,
  conversationKind: "pull_request",
  defaultBranch: "main",
  headRef: null,
  headSha: "a".repeat(40),
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
  ...o,
});
const SESSIONS = {
  "chase-opened": state({}),
  "mention-opened": state({ headRef: "feature", triggeringCommentId: 9 }),
  "review-opened": state({ headRef: "feature" }),
} as const;

const rig = (s: GitHubChannelState) => {
  const post = vi.fn<(body: string) => Promise<void>>(() => Promise.resolve());
  const react = vi.fn<(emoji: string) => Promise<void>>(() =>
    Promise.resolve()
  );
  const request = vi.fn<
    (input: { method: string; path: string }) => Promise<never>
  >(() => Promise.reject(new Error("GitHub is not reachable in a test")));
  const channel = { github: { request }, state: s, thread: { post, react } };
  return { channel, post, react, request };
};

describe("trace: an app turn in each kind of session", () => {
  it.each(Object.entries(SESSIONS))(
    "%s: question, reply, turn.failed, session.failed and turn.completed all leave the PR untouched",
    async (_name, opened) => {
      const h = await load();
      const { channel, post, request } = rig(structuredClone(opened));
      const quiet = vi.spyOn(console, "error").mockReturnValue();
      const log = vi.spyOn(console, "log").mockReturnValue();
      await within(app, () =>
        h["input.requested"](
          {
            requests: [{ options: [{ label: "rerun" }], prompt: "Rerun?" }],
            turnId: "turn_0",
          },
          channel
        )
      );
      await within(app, () =>
        h["message.completed"](
          {
            finishReason: "stop",
            message: "I did nothing.",
            stepIndex: 1,
            turnId: "turn_0",
          },
          channel
        )
      );
      await within(app, () =>
        h["turn.failed"](
          { code: "TURN_FAILED", message: "boom", turnId: "turn_0" },
          channel
        )
      );
      expect(FAILED_TURN.parse(channel.state).baymiFailedTurn).toBe("app");
      await h["session.failed"](
        { code: "TURN_FAILED", message: "boom", sessionId: "wrun_probe" },
        channel
      );
      await within(app, () =>
        h["turn.completed"]({ turnId: "turn_1" }, channel)
      );
      quiet.mockRestore();
      log.mockRestore();
      expect(post).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }
  );

  it("chase-opened, terminal session.failed alone (no turn.failed): Slack-only route, no PR write", async () => {
    const h = await load();
    const { channel, post, request } = rig(
      structuredClone(SESSIONS["chase-opened"])
    );
    const quiet = vi.spyOn(console, "error").mockReturnValue();
    await h["session.failed"](
      {
        code: "WORKFLOW_EXECUTION_FAILED",
        message: "x",
        sessionId: "wrun_probe",
      },
      channel
    );
    quiet.mockRestore();
    expect(post).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("control: a person's question is posted; a person's turn.failed posts the notice", async () => {
    const h = await load();
    const { channel, post } = rig(structuredClone(SESSIONS["mention-opened"]));
    const quiet = vi.spyOn(console, "error").mockReturnValue();
    await within(person, () =>
      h["input.requested"](
        {
          requests: [{ options: [{ label: "rerun" }], prompt: "Rerun?" }],
          turnId: "turn_0",
        },
        channel
      )
    );
    await within(person, () =>
      h["turn.failed"](
        { code: "TURN_FAILED", message: "boom", turnId: "turn_0" },
        channel
      )
    );
    quiet.mockRestore();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("control: a reviewer's turn.failed is quiet and its session.failed settles the check", async () => {
    const h = await load();
    const { channel, post, request } = rig(
      structuredClone(SESSIONS["review-opened"])
    );
    const quiet = vi.spyOn(console, "error").mockReturnValue();
    await within(reviewer, () =>
      h["turn.failed"](
        { code: "TURN_FAILED", message: "boom", turnId: "turn_0" },
        channel
      )
    );
    await h["session.failed"](
      { code: "TURN_FAILED", message: "boom", sessionId: "wrun_probe" },
      channel
    );
    quiet.mockRestore();
    expect(post).not.toHaveBeenCalled();
    expect(request.mock.calls.length).toBeGreaterThan(0);
  });

  it("a stale 'app' mark is cleared by the next turn.completed, so a later bare session.failed is judged by state again", async () => {
    const h = await load();
    const { channel, post } = rig(structuredClone(SESSIONS["mention-opened"]));
    const quiet = vi.spyOn(console, "error").mockReturnValue();
    await within(app, () =>
      h["turn.failed"](
        { code: "TURN_FAILED", message: "boom", turnId: "turn_0" },
        channel
      )
    );
    await within(person, () =>
      h["turn.completed"]({ turnId: "turn_1" }, channel)
    );
    await h["session.failed"](
      { code: "X", message: "x", sessionId: "wrun_probe" },
      channel
    );
    quiet.mockRestore();
    expect(post).toHaveBeenCalledOnce();
  });
});

const settledTool = (turnId: string) => ({
  result: {
    callId: "call_1",
    isError: false,
    kind: "tool-result",
    toolName: "github__rerunWorkflowRun",
  },
  status: "completed",
  turnId,
});

describe("the grounding ledger", () => {
  const REVIEW_TEXT =
    "Security review: no findings.\n\nNothing needs attention.";
  /** A review answers at step 1 in its own session having read nothing; returns what it posted. */
  const ungroundedReviewPosts = async (
    before?: (h: Handlers) => Promise<void>
  ): Promise<number> => {
    const h = await load();
    const quiet = vi.spyOn(console, "error").mockReturnValue();
    const log = vi.spyOn(console, "log").mockReturnValue();
    await before?.(h);
    const r = rig(structuredClone(SESSIONS["review-opened"]));
    await within(
      reviewer,
      () =>
        h["message.completed"](
          {
            finishReason: "stop",
            message: REVIEW_TEXT,
            stepIndex: 1,
            turnId: "turn_0",
          },
          r.channel
        ),
      "wrun_review"
    );
    quiet.mockRestore();
    log.mockRestore();
    return r.post.mock.calls.length;
  };

  it("holds back an ungrounded review when nothing ran before it", async () => {
    await expect(ungroundedReviewPosts()).resolves.toBe(0);
  });

  it("holds it back after an unrelated chase settled a tool call at its own turn_0", async () => {
    const posts = await ungroundedReviewPosts(async (h) => {
      const chase = rig(structuredClone(SESSIONS["chase-opened"]));
      await within(
        app,
        () => h["action.result"](settledTool("turn_0"), chase.channel),
        "wrun_chase"
      );
    });
    expect(posts).toBe(0);
  });

  it("holds it back after another review's tool call at the same turn_0 in a different session", async () => {
    const posts = await ungroundedReviewPosts(async (h) => {
      const other = rig(structuredClone(SESSIONS["review-opened"]));
      await within(
        reviewer,
        () => h["action.result"](settledTool("turn_0"), other.channel),
        "wrun_other_review"
      );
    });
    expect(posts).toBe(0);
  });

  it("does not note the app's tool call, even in the review's own session", async () => {
    const posts = await ungroundedReviewPosts(async (h) => {
      const shared = rig(structuredClone(SESSIONS["review-opened"]));
      await within(
        app,
        () => h["action.result"](settledTool("turn_0"), shared.channel),
        "wrun_review"
      );
    });
    expect(posts).toBe(0);
  });

  it("still grounds a review on its own session's tool call", async () => {
    const posts = await ungroundedReviewPosts(async (h) => {
      const own = rig(structuredClone(SESSIONS["review-opened"]));
      await within(
        reviewer,
        () => h["action.result"](settledTool("turn_0"), own.channel),
        "wrun_review"
      );
    });
    expect(posts).toBeGreaterThan(0);
  });
});
