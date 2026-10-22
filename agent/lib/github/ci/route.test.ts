import type { SessionAuthContext } from "eve/context";
import { describe, expect, it, vi } from "vitest";

import {
  isCiSessionState,
  replyRoute,
  routeCompletedMessage,
  sessionFailureRoute,
  turnFailureRoute,
} from "#lib/github/ci/route";
import type { SessionAnchor } from "#lib/github/ci/route";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

const app: SessionAuthContext = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

const reviewer: SessionAuthContext = {
  attributes: {},
  authenticator: "github-webhook",
  principalId: REVIEWER_PRINCIPAL,
  principalType: "service",
};

const maintainer: SessionAuthContext = {
  attributes: { user_login: "PunGrumpy" },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:10858",
  principalType: "user",
  subject: "PunGrumpy",
};

/** `reply` stands for `settleReply`, which reaches `postReply`; `chase` for the Slack-only end. */
const handlers = () => ({
  chase: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
  reply: vi.fn<(message: string) => Promise<void>>(() => Promise.resolve()),
});

describe("an app turn never reaches the pull request's reply path", () => {
  it("settles through the chase and calls neither settleReply nor postReply", async () => {
    const { chase, reply } = handlers();
    const route = await routeCompletedMessage({
      auth: app,
      chase,
      message: "I looked at it and it is fine.",
      reply,
    });
    expect(route).toBe("chase");
    expect(chase).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });

  it("holds when the app's auth carries a pull request and the maintainer's login", async () => {
    const { chase, reply } = handlers();
    await routeCompletedMessage({
      auth: {
        ...app,
        attributes: {
          pull_request_number: "7",
          repository: "PunGrumpy/baymi",
          user_login: "PunGrumpy",
        },
      },
      chase,
      message: "x",
      reply,
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it.each([
    ["a review", reviewer],
    ["a person's mention", maintainer],
    ["no caller", null],
  ])("still posts the reply of %s", async (_name, auth) => {
    const { chase, reply } = handlers();
    const route = await routeCompletedMessage({
      auth,
      chase,
      message: "a review",
      reply,
    });
    expect(route).toBe("reply");
    expect(reply).toHaveBeenCalledWith("a review");
    expect(chase).not.toHaveBeenCalled();
  });

  it("is decided by the class, not by a principal string", () => {
    expect(replyRoute({ ...app, principalType: "service" })).toBe("reply");
    expect(replyRoute({ ...app, principalId: "eve:other" })).toBe("reply");
  });
});

describe(turnFailureRoute, () => {
  it("keeps the public notice for a person, and nothing for the review or the app", () => {
    expect(turnFailureRoute(maintainer)).toBe("notice");
    expect(turnFailureRoute(null)).toBe("notice");
    expect(turnFailureRoute(reviewer)).toBe("quiet");
    expect(turnFailureRoute(app)).toBe("quiet");
  });
});

const state = (overrides: Partial<SessionAnchor> = {}): SessionAnchor => ({
  headRef: null,
  pullRequestNumber: 7,
  reviewCommentId: null,
  triggeringCommentId: null,
  ...overrides,
});

describe(sessionFailureRoute, () => {
  it("sends a session the chase opened to the chase's own report", () => {
    expect(isCiSessionState(state())).toBeTruthy();
    expect(sessionFailureRoute(state())).toBe("chase");
  });

  it("keeps a review's failure on the review's path", () => {
    expect(sessionFailureRoute(state({ headRef: "feature" }))).toBe("review");
  });

  it("keeps a mention's failure a notice", () => {
    expect(
      sessionFailureRoute(state({ headRef: "feature", triggeringCommentId: 9 }))
    ).toBe("notice");
    expect(sessionFailureRoute(state({ triggeringCommentId: 9 }))).toBe(
      "notice"
    );
    expect(sessionFailureRoute(state({ pullRequestNumber: null }))).toBe(
      "notice"
    );
  });
});
