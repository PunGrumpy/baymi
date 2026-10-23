import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import { APP_SCOPE, bindingProblem, bindingRefusal } from "#lib/chase/bind";
import { chaseAuth } from "#lib/github/ci/turn";
import type { CiTurn } from "#lib/github/ci/turn";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

/** What the GitHub channel mints for a webhook on PunGrumpy/baymi#42. */
const githubAuth = (
  attributes: Record<string, string> = {}
): SessionAuthContext => ({
  attributes: {
    pull_request_number: "42",
    repository: "PunGrumpy/baymi",
    user_login: "PunGrumpy",
    user_type: "User",
    ...attributes,
  },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:42",
  principalType: "user",
  subject: "PunGrumpy",
});

const turn = (overrides: Partial<CiTurn> = {}): CiTurn => ({
  attempt: 1,
  conclusion: "failure",
  evidence: "expected 5, got 2",
  headSha: HEAD,
  job: "Typecheck, lint, test",
  key: "pungrumpy/baymi#run1@1",
  kind: "own-code",
  reason: "in-diff",
  runId: 1,
  ...overrides,
});

const target = (overrides = {}) => ({
  headSha: HEAD,
  pullRequest: 42,
  repository: "PunGrumpy/baymi",
  ...overrides,
});

describe(bindingProblem, () => {
  it("binds the app to its CI turn's pull request, repository and head", () => {
    const app = chaseAuth(githubAuth(), turn());
    expect(bindingProblem(app, target())).toBeNull();
    expect(bindingProblem(app, target({ pullRequest: 7 }))).toBe(APP_SCOPE);
    expect(bindingProblem(app, target({ repository: "PunGrumpy/other" }))).toBe(
      APP_SCOPE
    );
    expect(bindingProblem(app, target({ headSha: OTHER_HEAD }))).toMatch(
      /CI turn is about head aaaaaaa, not bbbbbbb/u
    );
  });

  it("compares the repository without case", () => {
    const app = chaseAuth(githubAuth(), turn());
    expect(
      bindingProblem(app, target({ repository: "pungrumpy/BAYMI" }))
    ).toBeNull();
  });

  it("holds the app to the diff's own code", () => {
    for (const kind of [
      "flake",
      "stale-base",
      "external",
      "unknown",
    ] as const) {
      expect(
        bindingProblem(chaseAuth(githubAuth(), turn({ kind })), target())
      ).toBe(APP_SCOPE);
    }
  });

  it("refuses the app on a turn that is not about a pull request", () => {
    const schedule: SessionAuthContext = {
      attributes: {},
      authenticator: "app",
      principalId: "eve:app",
      principalType: "runtime",
    };
    expect(bindingProblem(schedule, target())).toBe(APP_SCOPE);
  });

  it("binds the maintainer to the pull request the turn is about", () => {
    const maintainer = githubAuth();
    expect(bindingProblem(maintainer, target())).toBeNull();
    expect(bindingProblem(maintainer, target({ pullRequest: 7 }))).toBe(
      "This turn is about PunGrumpy/baymi#42, not PunGrumpy/baymi#7."
    );
    expect(
      bindingProblem(maintainer, target({ repository: "PunGrumpy/other" }))
    ).toMatch(/not PunGrumpy\/other#42/u);
  });

  it("leaves the maintainer's head to the check against GitHub", () => {
    expect(
      bindingProblem(githubAuth(), target({ headSha: OTHER_HEAD }))
    ).toBeNull();
    expect(bindingProblem(githubAuth(), target({ headSha: null }))).toBeNull();
  });

  it("admits no chase from a turn with no pull request behind it", () => {
    const issue = githubAuth({ pull_request_number: "" });
    const slack: SessionAuthContext = {
      attributes: {},
      authenticator: "slack",
      principalId: "slack:T1:U1",
      principalType: "user",
    };
    for (const auth of [issue, slack, null]) {
      expect(bindingProblem(auth, target())).toMatch(
        /not about a pull request/u
      );
    }
  });
});

describe(bindingRefusal, () => {
  it("ends as a refusal that names the pull request the turn was handed", () => {
    const result = bindingRefusal(
      githubAuth(),
      target({ pullRequest: 7 }),
      "no"
    );
    expect(result.status).toBe("refused");
    expect(result.pullRequest).toBe(
      "https://github.com/PunGrumpy/baymi/pull/42"
    );
    expect(result.reason).toBe("no");
    expect(result.commits).toStrictEqual([]);
  });

  it("falls back to the pull request asked for when the turn has none", () => {
    const result = bindingRefusal(null, target({ pullRequest: 7 }), "no");
    expect(result.pullRequest).toBe(
      "https://github.com/PunGrumpy/baymi/pull/7"
    );
  });
});
