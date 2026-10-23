import { describe, expect, it, vi } from "vitest";

import { classifyPullRequest } from "#lib/digest/classify";
import type { FetchLike, RawContext, RawPullRequest } from "#lib/digest/github";
import { listOpenPullRequests, toFacts } from "#lib/digest/github";
import { CHECK_NAME } from "#lib/github/checks";

const actor = (login: string, typename = "User") => ({
  __typename: typename,
  login,
});

const checkRun = (
  name: string,
  status: string,
  conclusion: string | null
): RawContext => ({ __typename: "CheckRun", conclusion, name, status });

const statusContext = (context: string, state: string): RawContext => ({
  __typename: "StatusContext",
  context,
  state,
});

const rollup = (...nodes: RawContext[]) => ({
  contexts: { nodes, totalCount: nodes.length },
});

const commitWith = (...nodes: RawContext[]): RawPullRequest["commits"] => ({
  nodes: [{ commit: { statusCheckRollup: rollup(...nodes) } }],
});

/** One search node as GitHub returns it, green and by the maintainer. */
const node = (overrides: Partial<RawPullRequest> = {}): RawPullRequest => ({
  author: actor("PunGrumpy"),
  baseRef: { target: { statusCheckRollup: rollup() } },
  baseRefName: "main",
  comments: { nodes: [] },
  commits: commitWith(checkRun("Typecheck", "COMPLETED", "SUCCESS")),
  headRefName: "feat/thing",
  isDraft: false,
  latestOpinionatedReviews: { nodes: [] },
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  number: 7,
  repository: { nameWithOwner: "PunGrumpy/baymi" },
  reviewDecision: null,
  reviewThreads: { nodes: [] },
  title: "feat: a thing",
  ...overrides,
});

/** A search hit that is not a pull request comes back as an empty object. */
type SearchNode = RawPullRequest | Record<string, never>;

interface PageInfo {
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
}

const LAST_PAGE: PageInfo = { endCursor: null, hasNextPage: false };

interface GraphQLError {
  readonly message: string;
  readonly path?: readonly (number | string)[];
}

const page = (
  nodes: SearchNode[],
  pageInfo: PageInfo = LAST_PAGE,
  errors: readonly GraphQLError[] = []
) => ({
  data: { search: { nodes, pageInfo } },
  ...(errors.length > 0 && { errors }),
});

type Answer =
  | ReturnType<typeof page>
  | { data: null; errors: { message: string }[] };

/** Answers each request with the next body queued. */
const respond = (...bodies: Answer[]): FetchLike => {
  const queue = [...bodies];
  return () =>
    Promise.resolve({
      json: () => Promise.resolve(queue.shift() ?? page([])),
      ok: true,
      status: 200,
    });
};

const requestBody = (
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
  call: number
) => {
  const sent = fetchImpl.mock.calls[call]?.[1].body ?? "{}";
  return JSON.parse(sent);
};

describe(toFacts, () => {
  it("reads the plain fields", () => {
    expect(toFacts(node())).toMatchObject({
      author: { isBot: false, login: "PunGrumpy" },
      baseRef: "main",
      behind: false,
      conflicting: false,
      draft: false,
      headRef: "feat/thing",
      number: 7,
      repository: "PunGrumpy/baymi",
      reviewDecision: "none",
      title: "feat: a thing",
    });
  });

  it("marks a Bot actor as a bot", () => {
    expect(
      toFacts(node({ author: actor("dependabot", "Bot") })).author
    ).toStrictEqual({
      isBot: true,
      login: "dependabot",
    });
  });

  it("reads a deleted author as none", () => {
    expect(toFacts(node({ author: null })).author).toBeNull();
  });

  it("reads the merge state", () => {
    expect(
      toFacts(node({ mergeable: "CONFLICTING" })).conflicting
    ).toBeTruthy();
    expect(toFacts(node({ mergeStateStatus: "BEHIND" })).behind).toBeTruthy();
    expect(toFacts(node({ mergeable: "UNKNOWN" })).conflicting).toBeFalsy();
  });

  it("reads the review decision", () => {
    expect(
      toFacts(node({ reviewDecision: "CHANGES_REQUESTED" })).reviewDecision
    ).toBe("changes-requested");
    expect(toFacts(node({ reviewDecision: "APPROVED" })).reviewDecision).toBe(
      "approved"
    );
  });

  describe("changes requested", () => {
    type RawReview = NonNullable<
      RawPullRequest["latestOpinionatedReviews"]["nodes"]
    >[number];

    const review = (
      login: string,
      state: string,
      typename = "User"
    ): RawReview => ({
      author: actor(login, typename),
      state,
    });

    const requestedBy = (...nodes: RawReview[]) =>
      toFacts(node({ latestOpinionatedReviews: { nodes } })).changesRequestedBy;

    it("lists the people whose latest review asks for changes, bots included", () => {
      expect(
        requestedBy(
          review("octocat", "CHANGES_REQUESTED"),
          review("hubot", "APPROVED"),
          review("coderabbit", "CHANGES_REQUESTED", "Bot")
        )
      ).toStrictEqual([
        { isBot: false, login: "octocat" },
        { isBot: true, login: "coderabbit" },
      ]);
    });

    it("has nobody when no review asks for changes", () => {
      expect(requestedBy(review("hubot", "APPROVED"))).toStrictEqual([]);
      expect(requestedBy()).toStrictEqual([]);
    });

    it("skips a reviewer whose account is gone", () => {
      expect(
        requestedBy({ author: null, state: "CHANGES_REQUESTED" })
      ).toStrictEqual([]);
    });

    it("reads the reviews as unread when GitHub gave none back", () => {
      expect(
        toFacts(node({ latestOpinionatedReviews: { nodes: null } })).readFailed
      ).toBeTruthy();
    });

    it("reads the threads as unread when GitHub gave none back", () => {
      expect(
        toFacts(node({ reviewThreads: { nodes: null } })).readFailed
      ).toBeTruthy();
    });
  });

  describe("checks", () => {
    const checksOf = (...nodes: RawContext[]) =>
      toFacts(node({ commits: commitWith(...nodes) })).checks;

    it("reduces check runs and statuses to success, pending or failure", () => {
      expect(
        checksOf(
          checkRun("a", "COMPLETED", "SUCCESS"),
          checkRun("b", "COMPLETED", "NEUTRAL"),
          checkRun("c", "COMPLETED", "SKIPPED"),
          checkRun("d", "COMPLETED", "FAILURE"),
          checkRun("e", "IN_PROGRESS", null),
          checkRun("f", "QUEUED", null),
          statusContext("g", "SUCCESS"),
          statusContext("h", "PENDING"),
          statusContext("i", "FAILURE"),
          statusContext("j", "ERROR")
        ).map(({ name, state }) => [name, state])
      ).toStrictEqual([
        ["a", "success"],
        ["b", "success"],
        ["c", "success"],
        ["d", "failure"],
        ["e", "pending"],
        ["f", "pending"],
        ["g", "success"],
        ["h", "pending"],
        ["i", "failure"],
        ["j", "failure"],
      ]);
    });

    it("does not count a cancelled run, which a newer push replaced", () => {
      expect(checksOf(checkRun("a", "COMPLETED", "CANCELLED"))).toStrictEqual([
        { name: "a", state: "success", timedOut: false },
      ]);
    });

    it("marks a timeout", () => {
      expect(checksOf(checkRun("a", "COMPLETED", "TIMED_OUT"))).toStrictEqual([
        { name: "a", state: "failure", timedOut: true },
      ]);
    });

    it("has none for a commit GitHub has no rollup for", () => {
      const commits: RawPullRequest["commits"] = {
        nodes: [{ commit: { statusCheckRollup: null } }],
      };
      expect(toFacts(node({ commits })).checks).toStrictEqual([]);
    });

    describe("that GitHub did not hand over", () => {
      const readFailedFor = (
        commits: RawPullRequest["commits"],
        errored = false
      ) => toFacts(node({ commits }), errored).readFailed;

      it("are read when the commit has a rollup, or no checks at all", () => {
        expect(
          readFailedFor(commitWith(checkRun("a", "COMPLETED", "SUCCESS")))
        ).toBeFalsy();
        expect(
          readFailedFor({ nodes: [{ commit: { statusCheckRollup: null } }] })
        ).toBeFalsy();
        expect(readFailedFor(commitWith())).toBeFalsy();
      });

      it("are unread when there is no head commit to read them from", () => {
        expect(readFailedFor({ nodes: null })).toBeTruthy();
        expect(readFailedFor({ nodes: [] })).toBeTruthy();
      });

      it("are unread when the rollup came back without its contexts", () => {
        expect(
          readFailedFor({
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: { nodes: null, totalCount: 3 },
                  },
                },
              },
            ],
          })
        ).toBeTruthy();
      });

      it("are unread when a context is missing from the list", () => {
        const withHole: RawPullRequest["commits"] = {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [checkRun("a", "COMPLETED", "SUCCESS"), null],
                    totalCount: 2,
                  },
                },
              },
            },
          ],
        };
        expect(readFailedFor(withHole)).toBeTruthy();
      });

      it("are unread when there are more than the hundred it asked for", () => {
        const cutShort: RawPullRequest["commits"] = {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [checkRun("a", "COMPLETED", "SUCCESS")],
                    totalCount: 101,
                  },
                },
              },
            },
          ],
        };
        expect(readFailedFor(cutShort)).toBeTruthy();
      });

      it("are unread when GitHub reported an error against the pull request", () => {
        expect(
          readFailedFor(commitWith(checkRun("a", "COMPLETED", "SUCCESS")), true)
        ).toBeTruthy();
      });

      it("classify as blocked, not as green", () => {
        const verdict = classifyPullRequest(
          toFacts(node({ commits: { nodes: null } })),
          { owners: ["PunGrumpy"] },
          { siblingFailures: new Map(), stackedOn: false }
        );
        expect(verdict).toStrictEqual({
          bucket: "blocked",
          reason: { kind: "read-failed" },
        });
      });
    });

    it("leaves out the Baymi security review, pending or not", () => {
      const checks = checksOf(
        checkRun("Typecheck", "COMPLETED", "SUCCESS"),
        checkRun(CHECK_NAME, "IN_PROGRESS", null)
      );
      expect(checks.map(({ name }) => name)).toStrictEqual(["Typecheck"]);
    });

    it("leaves it out when it failed too: that is an unreviewed change, not a failing one", () => {
      expect(
        checksOf(checkRun(CHECK_NAME, "COMPLETED", "FAILURE"))
      ).toStrictEqual([]);
    });

    it("lets a pull request whose only open check is the Baymi review classify as green", () => {
      const verdict = classifyPullRequest(
        toFacts(
          node({
            commits: commitWith(
              checkRun("Typecheck", "COMPLETED", "SUCCESS"),
              checkRun(CHECK_NAME, "IN_PROGRESS", null)
            ),
          })
        ),
        { owners: ["PunGrumpy"] },
        { siblingFailures: new Map(), stackedOn: false }
      );
      expect(verdict).toStrictEqual({
        bucket: "needs-owner",
        reason: { kind: "ready" },
      });
    });
  });

  describe("the base branch", () => {
    it("lists the checks failing on the base's head", () => {
      const baseRef: RawPullRequest["baseRef"] = {
        target: {
          statusCheckRollup: rollup(
            checkRun("Vercel", "COMPLETED", "FAILURE"),
            checkRun("Test", "COMPLETED", "SUCCESS")
          ),
        },
      };
      expect(toFacts(node({ baseRef })).baseFailingChecks).toStrictEqual([
        "Vercel",
      ]);
    });

    it("has none failing when the base commit has no checks", () => {
      const baseRef: RawPullRequest["baseRef"] = {
        target: { statusCheckRollup: null },
      };
      expect(toFacts(node({ baseRef })).baseFailingChecks).toStrictEqual([]);
    });

    it("is unreadable when the base's checks came back short", () => {
      const baseRef: RawPullRequest["baseRef"] = {
        target: {
          statusCheckRollup: {
            contexts: {
              nodes: [checkRun("Test", "COMPLETED", "SUCCESS")],
              totalCount: 150,
            },
          },
        },
      };
      expect(toFacts(node({ baseRef })).baseFailingChecks).toBeNull();
    });

    it("is unreadable when the base branch is gone", () => {
      expect(toFacts(node({ baseRef: null })).baseFailingChecks).toBeNull();
    });
  });

  describe("threads and comments", () => {
    type RawThread = NonNullable<
      RawPullRequest["reviewThreads"]["nodes"]
    >[number];

    const thread = (
      first: string,
      last: string,
      overrides: Partial<NonNullable<RawThread>> = {}
    ): RawThread => ({
      first: {
        nodes: [
          { author: actor(first, first === "coderabbit" ? "Bot" : "User") },
        ],
      },
      isOutdated: false,
      isResolved: false,
      last: {
        nodes: [
          { author: actor(last, last === "coderabbit" ? "Bot" : "User") },
        ],
      },
      ...overrides,
    });

    it("reads who spoke last and whether a person was ever in the thread", () => {
      const reviewThreads: RawPullRequest["reviewThreads"] = {
        nodes: [
          thread("octocat", "octocat"),
          thread("coderabbit", "coderabbit"),
        ],
      };
      expect(toFacts(node({ reviewThreads })).threads).toStrictEqual([
        {
          humanParticipated: true,
          lastAuthor: { isBot: false, login: "octocat" },
          outdated: false,
          resolved: false,
        },
        {
          humanParticipated: false,
          lastAuthor: { isBot: true, login: "coderabbit" },
          outdated: false,
          resolved: false,
        },
      ]);
    });

    it("reads the last comment's author and whether it asks something, never its text", () => {
      const comments: RawPullRequest["comments"] = {
        nodes: [{ author: actor("octocat"), body: "why this?" }],
      };
      expect(toFacts(node({ comments })).lastComment).toStrictEqual({
        asksQuestion: true,
        author: { isBot: false, login: "octocat" },
      });
    });

    it("has no last comment on a quiet pull request", () => {
      expect(toFacts(node()).lastComment).toBeNull();
    });
  });
});

describe(listOpenPullRequests, () => {
  it("sends the query and the token and returns the facts", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      respond(page([node({ number: 1 }), node({ number: 2 })]))
    );
    const result = await listOpenPullRequests({
      fetchImpl,
      query: "user:PunGrumpy is:pr",
      token: "ghs_installation",
    });
    expect(result.facts.map(({ number }) => number)).toStrictEqual([1, 2]);
    expect(result.truncated).toBeFalsy();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/graphql");
    expect(init?.headers.authorization).toBe("Bearer ghs_installation");
    expect(requestBody(fetchImpl, 0)).toMatchObject({
      variables: { after: null, query: "user:PunGrumpy is:pr" },
    });
  });

  it("only ever sends a query, never a mutation", async () => {
    const fetchImpl = vi.fn<FetchLike>(respond(page([])));
    await listOpenPullRequests({ fetchImpl, query: "q", token: "t" });
    const { query } = requestBody(fetchImpl, 0);
    expect(query.trimStart().startsWith("query ")).toBeTruthy();
    expect(query).not.toMatch(/mutation/iu);
  });

  it("follows the cursor to the next page", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      respond(
        page([node({ number: 1 })], { endCursor: "c1", hasNextPage: true }),
        page([node({ number: 2 })])
      )
    );
    const result = await listOpenPullRequests({
      fetchImpl,
      query: "q",
      token: "t",
    });
    expect(result.facts.map(({ number }) => number)).toStrictEqual([1, 2]);
    expect(requestBody(fetchImpl, 1)).toMatchObject({
      variables: { after: "c1" },
    });
  });

  it("reports a listing the page cap cut short", async () => {
    const endless = Array.from({ length: 5 }, () =>
      page([node()], { endCursor: "c", hasNextPage: true })
    );
    const result = await listOpenPullRequests({
      fetchImpl: respond(...endless),
      query: "q",
      token: "t",
    });
    expect(result.truncated).toBeTruthy();
    expect(result.facts).toHaveLength(5);
  });

  it("skips a search hit that is not a pull request", async () => {
    const result = await listOpenPullRequests({
      fetchImpl: respond(page([{}, node({ number: 3 })])),
      query: "q",
      token: "t",
    });
    expect(result.facts.map(({ number }) => number)).toStrictEqual([3]);
  });

  describe("errors that come with data", () => {
    it("marks the pull request GitHub named, and no other, as unread", async () => {
      const result = await listOpenPullRequests({
        fetchImpl: respond(
          page(
            [node({ number: 1 }), node({ number: 2 }), node({ number: 3 })],
            LAST_PAGE,
            [
              {
                message: "Something went wrong while executing your query.",
                path: ["search", "nodes", 1, "commits", "nodes", 0],
              },
            ]
          )
        ),
        query: "q",
        token: "t",
      });
      expect(result.facts.map(({ readFailed }) => readFailed)).toStrictEqual([
        false,
        true,
        false,
      ]);
      expect(result.truncated).toBeFalsy();
    });

    it("counts a hit by its place in the page, which includes the ones skipped", async () => {
      const result = await listOpenPullRequests({
        fetchImpl: respond(
          page([{}, node({ number: 2 })], LAST_PAGE, [
            { message: "boom", path: ["search", "nodes", 1, "reviewThreads"] },
          ])
        ),
        query: "q",
        token: "t",
      });
      expect(result.facts).toMatchObject([{ number: 2, readFailed: true }]);
    });

    it("reads the listing as cut short when the error names no pull request", async () => {
      const result = await listOpenPullRequests({
        fetchImpl: respond(
          page([node({ number: 1 })], LAST_PAGE, [
            { message: "Something went wrong while executing your query." },
          ])
        ),
        query: "q",
        token: "t",
      });
      expect(result.truncated).toBeTruthy();
      expect(result.facts).toMatchObject([{ number: 1, readFailed: false }]);
    });

    it("keeps that mark across the pages after it", async () => {
      const result = await listOpenPullRequests({
        fetchImpl: respond(
          page([node({ number: 1 })], { endCursor: "c1", hasNextPage: true }, [
            { message: "timeout", path: ["search"] },
          ]),
          page([node({ number: 2 })])
        ),
        query: "q",
        token: "t",
      });
      expect(result.facts).toHaveLength(2);
      expect(result.truncated).toBeTruthy();
    });
  });

  it("throws on a bad status rather than report a short list as complete", async () => {
    await expect(
      listOpenPullRequests({
        fetchImpl: () =>
          Promise.resolve({
            json: () => Promise.resolve({}),
            ok: false,
            status: 502,
          }),
        query: "q",
        token: "t",
      })
    ).rejects.toThrow("502");
  });

  it("throws the GraphQL errors when there is no data", async () => {
    await expect(
      listOpenPullRequests({
        fetchImpl: respond({
          data: null,
          errors: [{ message: "Resource limits exceeded" }],
        }),
        query: "q",
        token: "t",
      })
    ).rejects.toThrow("Resource limits exceeded");
  });

  it("throws on a pull request it cannot read rather than skip it", async () => {
    const unreadable: SearchNode = Object.assign(Object.create(null), {
      number: 1,
    });
    await expect(
      listOpenPullRequests({
        fetchImpl: respond(page([unreadable])),
        query: "q",
        token: "t",
      })
    ).rejects.toThrow("expected");
  });
});
