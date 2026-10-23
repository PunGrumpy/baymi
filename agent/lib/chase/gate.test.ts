import type { SessionAuthContext } from "eve/context";
import { describe, expect, it, vi } from "vitest";

import { createMemoryBudgetStore } from "#lib/chase/budget";
import type { BudgetStore } from "#lib/chase/budget";
import type { GitHubSend } from "#lib/chase/commit";
import {
  admitChase,
  CHASE_DENIAL,
  chaseApproval,
  chaseMessage,
  hasModelKey,
} from "#lib/chase/gate";
import type { GateDeps } from "#lib/chase/gate";
import { chaseAuth } from "#lib/github/ci/turn";
import type { CiTurn } from "#lib/github/ci/turn";
import { REVIEWER_PRINCIPAL, TRUST_CLASSES } from "#lib/trust";
import type { TrustClass } from "#lib/trust";

const HEAD = "abc1234def5678";
const NOON = Date.parse("2026-10-23T12:00:00Z");

/** What the GitHub channel mints for a webhook on PunGrumpy/baymi#42. */
const githubAuth = (login: string): SessionAuthContext => ({
  attributes: {
    pull_request_number: "42",
    repository: "PunGrumpy/baymi",
    user_login: login,
    user_type: "User",
  },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:42",
  principalType: "user",
  subject: login,
});

const turn = (overrides: Partial<CiTurn> = {}): CiTurn => ({
  attempt: 1,
  conclusion: "failure",
  evidence: "src/math.test.ts > sum: expected 5, got 2",
  headSha: HEAD,
  job: "Typecheck, lint, test",
  key: "pungrumpy/baymi#run1@1",
  kind: "own-code",
  reason: "in-diff",
  runId: 1,
  ...overrides,
});

const PRINCIPALS = {
  app: chaseAuth(githubAuth("PunGrumpy"), turn()),
  collaborator: githubAuth("octocat"),
  maintainer: githubAuth("PunGrumpy"),
  reviewer: {
    ...githubAuth("octocat"),
    principalId: REVIEWER_PRINCIPAL,
    principalType: "service",
  },
  stranger: null,
} as const satisfies Record<TrustClass, SessionAuthContext | null>;

interface PullBody {
  readonly base: { readonly repo: { readonly full_name: string } };
  readonly draft: boolean;
  readonly head: {
    readonly ref: string;
    readonly repo: { readonly full_name: string } | null;
    readonly sha: string;
  };
  readonly html_url: string;
  readonly state: string;
  readonly title: string;
  readonly user: { readonly login: string; readonly type: string };
}

const pull = (overrides: Partial<PullBody> = {}): PullBody => ({
  base: { repo: { full_name: "PunGrumpy/baymi" } },
  draft: false,
  head: { ref: "feat/sum", repo: { full_name: "PunGrumpy/baymi" }, sha: HEAD },
  html_url: "https://github.com/PunGrumpy/baymi/pull/42",
  state: "open",
  title: "feat: sum",
  user: { login: "PunGrumpy", type: "User" },
  ...overrides,
});

const github = (
  pullBody: PullBody = pull(),
  headAuthor: string | null = "PunGrumpy"
) =>
  vi.fn<GitHubSend>((path) =>
    Promise.resolve(
      path.includes("/commits/")
        ? {
            body: {
              author: headAuthor === null ? null : { login: headAuthor },
            },
            status: 200,
          }
        : { body: pullBody, status: 200 }
    )
  );

const deps = (overrides: Partial<GateDeps> = {}): GateDeps => ({
  hasModelKey: true,
  now: NOON,
  send: github(),
  store: createMemoryBudgetStore(),
  ...overrides,
});

const REQUEST = {
  failure: "the sum test fails",
  pullRequest: 42,
  repository: "PunGrumpy/baymi",
};

describe(chaseApproval, () => {
  it("lets the app and the maintainer call the tool and denies every other class", () => {
    const allowed = { app: true, maintainer: true } as const;
    for (const trustClass of TRUST_CLASSES) {
      const status = chaseApproval(PRINCIPALS[trustClass]);
      expect(status).toStrictEqual(
        trustClass in allowed
          ? "not-applicable"
          : { reason: CHASE_DENIAL, type: "denied" }
      );
    }
  });
});

describe(admitChase, () => {
  it("admits the maintainer for the pull request they name", async () => {
    const admission = await admitChase(PRINCIPALS.maintainer, REQUEST, deps());
    expect(admission).toStrictEqual({
      ok: true,
      task: {
        failure: "the sum test fails",
        headRef: "feat/sum",
        headSha: HEAD,
        pullRequest: 42,
        repository: "PunGrumpy/baymi",
        url: "https://github.com/PunGrumpy/baymi/pull/42",
      },
    });
  });

  it("admits the app for its own CI turn's own-code failure, with the turn's evidence", async () => {
    const admission = await admitChase(PRINCIPALS.app, REQUEST, deps());
    expect(admission.ok).toBeTruthy();
    expect(admission.ok && admission.task.failure).toBe(
      "Typecheck, lint, test: src/math.test.ts > sum: expected 5, got 2"
    );
  });

  it("holds the maintainer to the pull request their turn is about, before reading GitHub", async () => {
    const send = github();
    const elsewhere = await admitChase(
      PRINCIPALS.maintainer,
      { ...REQUEST, pullRequest: 7 },
      deps({ send })
    );
    const otherRepository = await admitChase(
      PRINCIPALS.maintainer,
      { ...REQUEST, repository: "PunGrumpy/other" },
      deps({ send })
    );
    const issueComment = await admitChase(
      {
        ...PRINCIPALS.maintainer,
        attributes: {
          ...PRINCIPALS.maintainer.attributes,
          pull_request_number: "",
        },
      },
      REQUEST,
      deps({ send })
    );
    expect(!elsewhere.ok && elsewhere.result.reason).toMatch(/not .*#7/u);
    expect(!otherRepository.ok && otherRepository.result.status).toBe(
      "refused"
    );
    expect(!issueComment.ok && issueComment.result.reason).toMatch(
      /not about a pull request/u
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses every class the chase does not admit, before reading GitHub", async () => {
    for (const trustClass of [
      "collaborator",
      "reviewer",
      "stranger",
    ] as const) {
      const send = github();
      // oxlint-disable-next-line eslint/no-await-in-loop -- one class at a time
      const admission = await admitChase(
        PRINCIPALS[trustClass],
        REQUEST,
        deps({ send })
      );
      expect(admission.ok).toBeFalsy();
      expect(!admission.ok && admission.result.reason).toBe(CHASE_DENIAL);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("refuses the app outside its own pull request or for anything but own-code", async () => {
    const elsewhere = await admitChase(
      PRINCIPALS.app,
      { ...REQUEST, pullRequest: 7 },
      deps()
    );
    const flake = await admitChase(
      chaseAuth(githubAuth("PunGrumpy"), turn({ kind: "flake" })),
      REQUEST,
      deps()
    );
    for (const admission of [elsewhere, flake]) {
      expect(!admission.ok && admission.result.status).toBe("refused");
    }
  });

  it("calls a head that moved since the check failed superseded", async () => {
    const admission = await admitChase(
      PRINCIPALS.app,
      REQUEST,
      deps({ send: github(pull({ head: { ...pull().head, sha: "newer" } })) })
    );
    expect(!admission.ok && admission.result.status).toBe("superseded");
  });

  it("refuses a fork, a closed pull request, and a missing model key", async () => {
    const fork = await admitChase(
      PRINCIPALS.maintainer,
      REQUEST,
      deps({
        send: github(
          pull({
            head: {
              ...pull().head,
              repo: { full_name: "stranger/baymi" },
            },
          })
        ),
      })
    );
    const closed = await admitChase(
      PRINCIPALS.maintainer,
      REQUEST,
      deps({ send: github(pull({ state: "closed" })) })
    );
    const keyless = await admitChase(
      PRINCIPALS.maintainer,
      REQUEST,
      deps({ hasModelKey: false })
    );
    expect(!fork.ok && fork.result.reason).toMatch(/fork/u);
    expect(!closed.ok && closed.result.reason).toBe(
      "The pull request is not open."
    );
    expect(!keyless.ok && keyless.result.reason).toMatch(/ANTHROPIC_API_KEY/u);
  });

  it("does not let the app chase its own fix, or a head it cannot attribute", async () => {
    const own = await admitChase(
      PRINCIPALS.app,
      REQUEST,
      deps({ send: github(pull(), "baymiai[bot]") })
    );
    expect(!own.ok && own.result.reason).toMatch(/own fix/u);
    const unreadable = vi.fn<GitHubSend>((path) =>
      Promise.resolve(
        path.includes("/commits/")
          ? { body: {}, status: 502 }
          : { body: pull(), status: 200 }
      )
    );
    const unknown = await admitChase(
      PRINCIPALS.app,
      REQUEST,
      deps({ send: unreadable })
    );
    expect(!unknown.ok && unknown.result.status).toBe("refused");
  });

  it("treats a head whose author GitHub cannot name as maybe the chase's own", async () => {
    const send = github(pull(), null);
    const admission = await admitChase(PRINCIPALS.app, REQUEST, deps({ send }));
    expect(admission.ok).toBeFalsy();
    expect(!admission.ok && admission.result.status).toBe("refused");
    expect(!admission.ok && admission.result.reason).toMatch(
      /may be the chase's own fix/u
    );
    const missing = vi.fn<GitHubSend>((path) =>
      Promise.resolve(
        path.includes("/commits/")
          ? { body: {}, status: 200 }
          : { body: pull(), status: 200 }
      )
    );
    const noField = await admitChase(
      PRINCIPALS.app,
      REQUEST,
      deps({ send: missing })
    );
    expect(!noField.ok && noField.result.status).toBe("refused");
  });

  it("claims the budget last and refuses once the head or the day is spent", async () => {
    const store = createMemoryBudgetStore();
    const first = await admitChase(
      PRINCIPALS.maintainer,
      REQUEST,
      deps({ store })
    );
    const again = await admitChase(
      PRINCIPALS.maintainer,
      REQUEST,
      deps({ store })
    );
    expect(first.ok).toBeTruthy();
    expect(!again.ok && again.result.reason).toBe(
      "This head was chased already."
    );
    const broken: BudgetStore = {
      claim: () => Promise.reject(new Error("unreadable")),
    };
    const closed = await admitChase(
      PRINCIPALS.maintainer,
      REQUEST,
      deps({ store: broken })
    );
    expect(!closed.ok && closed.result.reason).toMatch(/could not be read/u);
  });
});

describe(chaseMessage, () => {
  it("names the task exactly and quotes the failure on one line", () => {
    const message = chaseMessage({
      failure: "line one\nline two",
      headRef: "feat/sum",
      headSha: HEAD,
      pullRequest: 42,
      repository: "PunGrumpy/baymi",
      url: "https://github.com/PunGrumpy/baymi/pull/42",
    });
    expect(message).toContain(`- headSha: ${HEAD}`);
    expect(message).toContain("> line one line two");
  });
});

describe(hasModelKey, () => {
  it("needs a non-blank ANTHROPIC_API_KEY", () => {
    expect(hasModelKey({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBeTruthy();
    expect(hasModelKey({ ANTHROPIC_API_KEY: "  " })).toBeFalsy();
    expect(hasModelKey({})).toBeFalsy();
  });
});
