import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import { questionRoute, renderQuestions } from "#lib/github/ci/question";
import { REVIEWER_PRINCIPAL } from "#lib/trust";

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

describe(questionRoute, () => {
  it("drops the app's question, so a chase posts nothing on the pull request", () => {
    expect(questionRoute(app)).toBe("drop");
  });

  it("posts a person's question, and the review's, as before", () => {
    expect(questionRoute(maintainer)).toBe("post");
    expect(
      questionRoute({
        ...maintainer,
        principalId: REVIEWER_PRINCIPAL,
        principalType: "service",
      })
    ).toBe("post");
    expect(questionRoute(null)).toBe("post");
  });
});

describe(renderQuestions, () => {
  it("renders eve's default: the prompt, the numbered options, and how to answer", () => {
    expect(
      renderQuestions(
        [
          {
            options: [
              { label: "rerun" },
              { description: "leave it to me", label: "wait" },
            ],
            prompt: "Should I rerun run 123 or wait for you?",
          },
        ],
        "baymiai"
      )
    ).toBe(
      [
        "Should I rerun run 123 or wait for you?",
        "",
        "1. rerun",
        "2. wait - leave it to me",
        "",
        "Answer by mentioning me in a reply, e.g. `@baymiai rerun`.",
      ].join("\n")
    );
  });

  it("says a free answer is allowed, and uses a placeholder when no request has options", () => {
    expect(
      renderQuestions(
        [{ allowFreeform: true, prompt: "Which branch?" }],
        "baymiai"
      )
    ).toBe(
      [
        "Which branch?",
        "",
        "You can also reply with a custom answer.",
        "",
        "Answer by mentioning me in a reply, e.g. `@baymiai <your answer>`.",
      ].join("\n")
    );
  });

  it("is null when there is nothing to ask", () => {
    expect(renderQuestions([], "baymiai")).toBeNull();
  });
});
