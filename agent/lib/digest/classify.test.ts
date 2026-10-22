import { describe, expect, it } from "vitest";

import type {
  CheckFact,
  DigestContext,
  PullRequestFacts,
  Relations,
  ThreadFact,
} from "#lib/digest/classify";
import { classifyAll, classifyPullRequest } from "#lib/digest/classify";

const context: DigestContext = { owners: ["PunGrumpy"] };

const owner = { isBot: false, login: "PunGrumpy" };
const reviewer = { isBot: false, login: "octocat" };
const dependabot = { isBot: true, login: "dependabot" };
const releaseBot = { isBot: true, login: "github-actions" };

const passing = (name: string): CheckFact => ({
  name,
  state: "success",
  timedOut: false,
});
const failing = (name: string, timedOut = false): CheckFact => ({
  name,
  state: "failure",
  timedOut,
});
const pending = (name: string): CheckFact => ({
  name,
  state: "pending",
  timedOut: false,
});

const thread = (overrides: Partial<ThreadFact> = {}): ThreadFact => ({
  humanParticipated: false,
  lastAuthor: dependabot,
  outdated: false,
  resolved: false,
  ...overrides,
});

/** A green pull request by the maintainer, which every test bends one way. */
const facts = (
  overrides: Partial<PullRequestFacts> = {}
): PullRequestFacts => ({
  author: owner,
  baseFailingChecks: [],
  baseRef: "main",
  behind: false,
  checks: [passing("Typecheck"), passing("Test")],
  conflicting: false,
  draft: false,
  headRef: "feat/thing",
  lastComment: null,
  number: 1,
  repository: "PunGrumpy/baymi",
  reviewDecision: "none",
  threads: [],
  title: "feat: a thing",
  ...overrides,
});

const ALONE: Relations = { sharedFailures: new Set(), stackedOn: false };

const verdict = (
  overrides: Partial<PullRequestFacts> = {},
  relations: Relations = ALONE
) => classifyPullRequest(facts(overrides), context, relations);

describe(classifyPullRequest, () => {
  it("leaves a draft out entirely", () => {
    expect(verdict({ draft: true })).toBeNull();
  });

  it("sends a green pull request to the maintainer to merge", () => {
    expect(verdict()).toStrictEqual({
      bucket: "needs-owner",
      reason: { kind: "ready" },
    });
  });

  it("calls a pull request with no checks at all green", () => {
    expect(verdict({ checks: [] })).toStrictEqual({
      bucket: "needs-owner",
      reason: { kind: "ready" },
    });
  });

  describe("failing CI", () => {
    it("is the diff's own when the check passes on the base branch", () => {
      expect(
        verdict({ baseFailingChecks: [], checks: [failing("Typecheck")] })
      ).toStrictEqual({
        bucket: "blocked",
        reason: {
          behind: false,
          checks: ["Typecheck"],
          failure: "diff",
          kind: "ci",
        },
      });
    });

    it("is a stale base when every failing check fails on the base branch too", () => {
      expect(
        verdict({
          baseFailingChecks: ["Vercel", "Typecheck"],
          behind: true,
          checks: [failing("Vercel")],
        })
      ).toStrictEqual({
        bucket: "blocked",
        reason: {
          behind: true,
          checks: ["Vercel"],
          failure: "stale-base",
          kind: "ci",
        },
      });
    });

    it("is the diff's when only some failing checks also fail on the base", () => {
      expect(
        verdict({
          baseFailingChecks: ["Vercel"],
          checks: [failing("Vercel"), failing("Typecheck")],
        })
      ).toMatchObject({ reason: { failure: "diff" } });
    });

    it("is a stale base when other pull requests fail the same check", () => {
      expect(
        verdict(
          { baseFailingChecks: [], checks: [failing("Vercel")] },
          { ...ALONE, sharedFailures: new Set(["Vercel"]) }
        )
      ).toMatchObject({ reason: { failure: "stale-base" } });
    });

    it("is the diff's when only some failing checks are shared", () => {
      expect(
        verdict(
          {
            baseFailingChecks: [],
            checks: [failing("Vercel"), failing("Typecheck")],
          },
          { ...ALONE, sharedFailures: new Set(["Vercel"]) }
        )
      ).toMatchObject({ reason: { failure: "diff" } });
    });

    it("reads a runner timeout as a flake", () => {
      expect(verdict({ checks: [failing("Test", true)] })).toMatchObject({
        reason: { failure: "flake" },
      });
    });

    it("stays unknown when the base branch cannot be read", () => {
      expect(
        verdict({ baseFailingChecks: null, checks: [failing("Test")] })
      ).toMatchObject({ reason: { failure: "unknown" } });
    });

    it("blocks the pull request while a passing check sits beside the failing one", () => {
      expect(
        verdict({ checks: [passing("Lint"), failing("Typecheck")] })
      ).toMatchObject({ bucket: "blocked" });
    });
  });

  describe("the Baymi security review", () => {
    // The GraphQL mapping drops its check before the classifier sees it, so
    // `github.test.ts` covers the pending case end to end. This pins the
    // classifier's side: with only the other checks in, the pull request is
    // green.
    it("leaves a pull request green when it is the only check not yet reported", () => {
      expect(verdict({ checks: [passing("Typecheck")] })).toMatchObject({
        reason: { kind: "ready" },
      });
    });
  });

  describe("bot release pull requests", () => {
    const TITLES = [
      "Version Packages",
      "chore: Version packages",
      "Version Packages (next)",
      "chore(release): v1.2.3",
      "chore(release): version packages",
      "chore(main): release 1.2.3",
      "chore(main): release gozo 0.4.0",
      "chore: release v2.0.0",
    ];

    it.each(TITLES)("are healthy when CI is green: %s", (title) => {
      expect(verdict({ author: releaseBot, title })).toStrictEqual({
        bucket: "healthy",
        reason: "release",
      });
    });

    it.each(["changeset-release/main", "release-please--branches--main"])(
      "are healthy by their branch when the title says nothing: %s",
      (headRef) => {
        expect(
          verdict({ author: releaseBot, headRef, title: "Update packages" })
        ).toStrictEqual({ bucket: "healthy", reason: "release" });
      }
    );

    it.each([
      ["github-actions", { isBot: true, login: "github-actions" }],
      ["github-actions[bot]", { isBot: true, login: "github-actions[bot]" }],
      ["dependabot", { isBot: true, login: "dependabot" }],
      ["renovate", { isBot: true, login: "renovate" }],
      [
        "a known bot login the flag missed",
        { isBot: false, login: "renovate" },
      ],
      [
        "a [bot] login the flag missed",
        { isBot: false, login: "release-please[bot]" },
      ],
    ])("are recognised for the author %s", (_name, author) => {
      expect(verdict({ author, title: "Version Packages" })).toStrictEqual({
        bucket: "healthy",
        reason: "release",
      });
    });

    it("is gozo#1, a changesets pull request from github-actions", () => {
      expect(
        verdict({
          author: releaseBot,
          headRef: "changeset-release/main",
          number: 1,
          repository: "PunGrumpy/gozo",
          title: "chore: Version packages",
        })
      ).toStrictEqual({ bucket: "healthy", reason: "release" });
    });

    it("are blocked when CI fails", () => {
      expect(
        verdict({
          author: releaseBot,
          checks: [failing("Test")],
          title: "Version Packages",
        })
      ).toMatchObject({ bucket: "blocked" });
    });

    it("are healthy even with a conflict, which the bot regenerates", () => {
      expect(
        verdict({
          author: releaseBot,
          conflicting: true,
          title: "Version Packages",
        })
      ).toStrictEqual({ bucket: "healthy", reason: "release" });
    });

    it.each(TITLES)(
      "do not include a person's pull request titled like one: %s",
      (title) => {
        expect(verdict({ title })).toMatchObject({
          reason: { kind: "ready" },
        });
      }
    );

    it.each(["changeset-release/main", "release-please--branches--main"])(
      "do not include a person's pull request from the bot's branch: %s",
      (headRef) => {
        expect(verdict({ headRef, title: "Update packages" })).toMatchObject({
          reason: { kind: "ready" },
        });
      }
    );

    it("do not include a bot's pull request that is not a release", () => {
      expect(
        verdict({
          author: dependabot,
          headRef: "dependabot/npm_and_yarn/release-it-2.0.0",
          title: "chore(deps): bump release-it from 1.0.0 to 2.0.0",
        })
      ).toMatchObject({ reason: { kind: "ready" } });
    });
  });

  describe("conflicts", () => {
    it("need the author, so the maintainer hears of them", () => {
      expect(verdict({ conflicting: true })).toStrictEqual({
        bucket: "needs-owner",
        reason: { kind: "conflict" },
      });
    });

    it("beat failing CI, which a rebase may clear", () => {
      expect(
        verdict({ checks: [failing("Test")], conflicting: true })
      ).toMatchObject({ reason: { kind: "conflict" } });
    });

    it("are a bot's to rebase", () => {
      expect(verdict({ author: dependabot, conflicting: true })).toStrictEqual({
        bucket: "healthy",
        reason: "waiting-author",
      });
    });
  });

  describe("questions", () => {
    it("send an unresolved thread whose last word is someone else's to the maintainer", () => {
      expect(
        verdict({ threads: [thread({ lastAuthor: reviewer })] })
      ).toStrictEqual({
        bucket: "needs-owner",
        reason: { from: "octocat", kind: "question" },
      });
    });

    it("are answered once the maintainer has the last word", () => {
      expect(
        verdict({ threads: [thread({ lastAuthor: owner })] })
      ).toMatchObject({ reason: { kind: "ready" } });
    });

    it("are answered once the thread is resolved", () => {
      expect(
        verdict({
          threads: [thread({ lastAuthor: reviewer, resolved: true })],
        })
      ).toMatchObject({ reason: { kind: "ready" } });
    });

    it("count a last comment that asks something, not one that does not", () => {
      expect(
        verdict({ lastComment: { asksQuestion: true, author: reviewer } })
      ).toMatchObject({ reason: { from: "octocat", kind: "question" } });
      expect(
        verdict({ lastComment: { asksQuestion: false, author: reviewer } })
      ).toMatchObject({ reason: { kind: "ready" } });
    });

    it("never count a bot's comment", () => {
      expect(
        verdict({ lastComment: { asksQuestion: true, author: dependabot } })
      ).toMatchObject({ reason: { kind: "ready" } });
    });

    it("match the maintainer's login without regard to case", () => {
      expect(
        verdict({
          threads: [
            thread({ lastAuthor: { isBot: false, login: "pungrumpy" } }),
          ],
        })
      ).toMatchObject({ reason: { kind: "ready" } });
    });

    it("beat failing CI, since a person is waiting", () => {
      expect(
        verdict({
          checks: [failing("Test")],
          threads: [thread({ lastAuthor: reviewer })],
        })
      ).toMatchObject({ reason: { kind: "question" } });
    });
  });

  describe("bot findings", () => {
    it("block a pull request whose bot threads nobody has touched", () => {
      expect(verdict({ threads: [thread(), thread()] })).toStrictEqual({
        bucket: "blocked",
        reason: { kind: "bot-findings", threads: 2 },
      });
    });

    it("do not count a thread a person has joined, resolved, or that is outdated", () => {
      expect(
        verdict({
          threads: [
            thread({ humanParticipated: true }),
            thread({ resolved: true }),
            thread({ outdated: true }),
          ],
        })
      ).toMatchObject({ reason: { kind: "ready" } });
    });
  });

  describe("waiting", () => {
    it("on a pending check is healthy", () => {
      expect(
        verdict({ checks: [passing("Lint"), pending("Test")] })
      ).toStrictEqual({ bucket: "healthy", reason: "waiting-ci" });
    });

    it("on the author after a review asked for changes is healthy", () => {
      expect(verdict({ reviewDecision: "changes-requested" })).toStrictEqual({
        bucket: "healthy",
        reason: "waiting-author",
      });
    });

    it("on the pull request it is stacked on is healthy", () => {
      expect(
        verdict({ baseRef: "feat/base" }, { ...ALONE, stackedOn: true })
      ).toStrictEqual({
        bucket: "healthy",
        reason: "stacked",
      });
    });
  });
});

describe(classifyAll, () => {
  it("drops drafts and keeps the order it was given", () => {
    const result = classifyAll(
      [
        facts({ number: 3 }),
        facts({ draft: true, number: 2 }),
        facts({ number: 1 }),
      ],
      context
    );
    expect(result.map(({ number }) => number)).toStrictEqual([3, 1]);
  });

  it("finds a stack from one pull request's head being another's base", () => {
    const result = classifyAll(
      [
        facts({ headRef: "feat/base", number: 1 }),
        facts({
          baseRef: "feat/base",
          headRef: "feat/top",
          number: 2,
        }),
      ],
      context
    );
    expect(result.map(({ verdict: v }) => v)).toStrictEqual([
      { bucket: "needs-owner", reason: { kind: "ready" } },
      { bucket: "healthy", reason: "stacked" },
    ]);
  });

  it("does not stack across repositories", () => {
    const result = classifyAll(
      [
        facts({ headRef: "feat/base", number: 1 }),
        facts({
          baseRef: "feat/base",
          number: 2,
          repository: "PunGrumpy/other",
        }),
      ],
      context
    );
    expect(result.map(({ verdict: v }) => v.bucket)).toStrictEqual([
      "needs-owner",
      "needs-owner",
    ]);
  });
});

describe("a check that fails on several pull requests of one repository", () => {
  const withFailing = (number: number, repository = "PunGrumpy/baymi") =>
    facts({
      baseFailingChecks: [],
      checks: [failing("Vercel")],
      headRef: `feat/${number}`,
      number,
      repository,
    });

  it("is not the diff's once two other pull requests fail it", () => {
    const result = classifyAll(
      [withFailing(1), withFailing(2), withFailing(3)],
      context
    );
    expect(
      result.map(({ verdict: v }) => v.bucket === "blocked" && v.reason)
    ).toMatchObject([
      { failure: "stale-base" },
      { failure: "stale-base" },
      { failure: "stale-base" },
    ]);
  });

  it("is still the diff's when only one other pull request fails it", () => {
    const result = classifyAll([withFailing(1), withFailing(2)], context);
    expect(
      result.map(({ verdict: v }) => v.bucket === "blocked" && v.reason)
    ).toMatchObject([{ failure: "diff" }, { failure: "diff" }]);
  });

  it("does not count failures in another repository", () => {
    const result = classifyAll(
      [
        withFailing(1),
        withFailing(2),
        withFailing(3, "PunGrumpy/other"),
        withFailing(4, "PunGrumpy/other"),
      ],
      context
    );
    expect(
      result.map(({ verdict: v }) => v.bucket === "blocked" && v.reason)
    ).toMatchObject([
      { failure: "diff" },
      { failure: "diff" },
      { failure: "diff" },
      { failure: "diff" },
    ]);
  });

  it("does not count a draft's failure", () => {
    const result = classifyAll(
      [withFailing(1), withFailing(2), { ...withFailing(3), draft: true }],
      context
    );
    expect(
      result.map(({ verdict: v }) => v.bucket === "blocked" && v.reason)
    ).toMatchObject([{ failure: "diff" }, { failure: "diff" }]);
  });
});
