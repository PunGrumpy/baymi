import { z } from "zod";

import type {
  CheckFact,
  CheckState,
  Person,
  PullRequestFacts,
  ReviewDecision,
  ThreadFact,
} from "#lib/digest/classify";
import { CHECK_NAME } from "#lib/github/checks";

/**
 * Reads the open pull requests the digest is about, in one GraphQL search.
 *
 * @remarks
 * The digest runs from a schedule handler, which has no model and so none of
 * the `github__*` tools. It reads what those tools read (the search, the
 * checks on the head commit, the review threads) with the installation token,
 * and only reads: the one request is a query, and nothing here can write.
 * One search carries everything a pull request needs, base branch included,
 * so a morning's digest is a handful of requests however many pull requests
 * are open.
 */

const GRAPHQL_URL = "https://api.github.com/graphql";
const PAGE_SIZE = 50;
/** A bound on a runaway loop: 250 open pull requests is not one person's. */
const MAX_PAGES = 5;

const QUERY = `
query Digest($query: String!, $after: String, $pageSize: Int!) {
  search(query: $query, type: ISSUE, first: $pageSize, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        isDraft
        mergeable
        mergeStateStatus
        reviewDecision
        latestOpinionatedReviews(first: 20) {
          nodes { state author { __typename login } }
        }
        baseRefName
        headRefName
        repository { nameWithOwner }
        author { __typename login }
        baseRef {
          target {
            ... on Commit {
              statusCheckRollup { contexts(first: 100) { totalCount nodes { ...Context } } }
            }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup { contexts(first: 100) { totalCount nodes { ...Context } } }
            }
          }
        }
        reviewThreads(first: 50) {
          nodes {
            isResolved
            isOutdated
            first: comments(first: 20) { nodes { author { __typename login } } }
            last: comments(last: 1) { nodes { author { __typename login } } }
          }
        }
        comments(last: 1) { nodes { body author { __typename login } } }
      }
    }
  }
}
fragment Context on StatusCheckRollupContext {
  __typename
  ... on CheckRun { name status conclusion }
  ... on StatusContext { context state }
}`;

const ACTOR = z
  .object({ __typename: z.string(), login: z.string() })
  .nullable();

const CONTEXT = z
  .discriminatedUnion("__typename", [
    z.object({
      __typename: z.literal("CheckRun"),
      conclusion: z.string().nullable(),
      name: z.string(),
      status: z.string(),
    }),
    z.object({
      __typename: z.literal("StatusContext"),
      context: z.string(),
      state: z.string(),
    }),
  ])
  .nullable();

const ROLLUP = z
  .object({
    contexts: z.object({
      nodes: z.array(CONTEXT).nullable(),
      totalCount: z.int(),
    }),
  })
  .nullable();

const COMMENTS = z.object({
  nodes: z.array(z.object({ author: ACTOR })).nullable(),
});

const PULL_REQUEST = z.object({
  author: ACTOR,
  baseRef: z
    .object({
      target: z.object({ statusCheckRollup: ROLLUP.optional() }).nullable(),
    })
    .nullable(),
  baseRefName: z.string(),
  comments: z.object({
    nodes: z.array(z.object({ author: ACTOR, body: z.string() })).nullable(),
  }),
  commits: z.object({
    nodes: z
      .array(
        z.object({
          commit: z.object({ statusCheckRollup: ROLLUP }),
        })
      )
      .nullable(),
  }),
  headRefName: z.string(),
  isDraft: z.boolean(),
  latestOpinionatedReviews: z.object({
    nodes: z
      .array(z.object({ author: ACTOR, state: z.string() }).nullable())
      .nullable(),
  }),
  mergeStateStatus: z.string(),
  mergeable: z.string(),
  number: z.int(),
  repository: z.object({ nameWithOwner: z.string() }),
  reviewDecision: z.string().nullable(),
  reviewThreads: z.object({
    nodes: z
      .array(
        z
          .object({
            first: COMMENTS,
            isOutdated: z.boolean(),
            isResolved: z.boolean(),
            last: COMMENTS,
          })
          .nullable()
      )
      .nullable(),
  }),
  title: z.string(),
});

/** One search hit as GitHub returns it. */
export type RawPullRequest = z.infer<typeof PULL_REQUEST>;

/** One check run or status on a commit's rollup. */
export type RawContext = NonNullable<z.infer<typeof CONTEXT>>;

const GRAPHQL_ERROR = z.object({
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});

const PAGE = z.object({
  data: z
    .object({
      search: z.object({
        nodes: z.array(z.looseObject({})).nullable(),
        pageInfo: z.object({
          endCursor: z.string().nullable(),
          hasNextPage: z.boolean(),
        }),
      }),
    })
    .nullable(),
  errors: z.array(GRAPHQL_ERROR).optional(),
});

const person = (actor: z.infer<typeof ACTOR>): Person | null =>
  actor === null
    ? null
    : {
        isBot: actor.__typename === "Bot" || actor.login.endsWith("[bot]"),
        login: actor.login,
      };

const SUCCESSFUL_CONCLUSIONS = new Set([
  "CANCELLED",
  "NEUTRAL",
  "SKIPPED",
  "SUCCESS",
]);

const FAILED_STATUSES = new Set(["ERROR", "FAILURE"]);
const PENDING_STATUSES = new Set(["EXPECTED", "PENDING"]);

const TIMEOUT_CONCLUSIONS = new Set(["TIMED_OUT"]);

/**
 * One check or status as one of three states. A cancelled run counts as
 * passed: a newer push cancels the run it replaces, and the replacement is a
 * check of its own in the same list.
 */
const checkOf = (context: RawContext): CheckFact => {
  if (context.__typename === "StatusContext") {
    let state: CheckState = "success";
    if (FAILED_STATUSES.has(context.state)) {
      state = "failure";
    } else if (PENDING_STATUSES.has(context.state)) {
      state = "pending";
    }
    return { name: context.context, state, timedOut: false };
  }
  if (context.status !== "COMPLETED") {
    return { name: context.name, state: "pending", timedOut: false };
  }
  const conclusion = context.conclusion ?? "";
  return {
    name: context.name,
    state: SUCCESSFUL_CONCLUSIONS.has(conclusion) ? "success" : "failure",
    timedOut: TIMEOUT_CONCLUSIONS.has(conclusion),
  };
};

/**
 * The checks on a rollup, or `null` when GitHub did not hand over every one:
 * an empty or short list, a context it would not show, or more contexts than
 * the first hundred. A commit with no checks has no rollup at all, which is
 * an answer, not a gap.
 */
const readChecks = (rollup: z.infer<typeof ROLLUP>): CheckFact[] | null => {
  if (rollup === null) {
    return [];
  }
  const { nodes, totalCount } = rollup.contexts;
  if (nodes === null || nodes.length < totalCount) {
    return null;
  }
  const contexts = nodes.filter((context) => context !== null);
  if (contexts.length < nodes.length) {
    return null;
  }
  return (
    contexts
      .map(checkOf)
      // The Baymi check reports and never gates a pull request.
      .filter((check) => check.name !== CHECK_NAME)
  );
};

const reviewDecisionOf = (decision: string | null): ReviewDecision => {
  switch (decision) {
    case "APPROVED": {
      return "approved";
    }
    case "CHANGES_REQUESTED": {
      return "changes-requested";
    }
    default: {
      return "none";
    }
  }
};

const threadOf = (
  thread: NonNullable<
    NonNullable<RawPullRequest["reviewThreads"]["nodes"]>[number]
  >
): ThreadFact => ({
  humanParticipated: (thread.first.nodes ?? []).some(
    (node) => person(node.author)?.isBot === false
  ),
  lastAuthor: person(thread.last.nodes?.[0]?.author ?? null),
  outdated: thread.isOutdated,
  resolved: thread.isResolved,
});

/** Everyone whose latest review of the pull request asks for changes. */
const changesRequestedBy = (raw: RawPullRequest): Person[] =>
  (raw.latestOpinionatedReviews.nodes ?? [])
    .filter((review) => review?.state === "CHANGES_REQUESTED")
    .map((review) => person(review?.author ?? null))
    .filter((reviewer) => reviewer !== null);

/**
 * One search result as the facts the classifier reads.
 *
 * @param errored - Whether GitHub reported an error against this node, which
 * leaves whatever it did return incomplete.
 */
export const toFacts = (
  raw: RawPullRequest,
  errored = false
): PullRequestFacts => {
  const head = raw.commits.nodes?.[0];
  const headChecks =
    head === undefined ? null : readChecks(head.commit.statusCheckRollup);
  const base = raw.baseRef?.target?.statusCheckRollup;
  const baseChecks = base === undefined ? null : readChecks(base);
  const comment = raw.comments.nodes?.[0];
  return {
    author: person(raw.author),
    baseFailingChecks:
      baseChecks === null
        ? null
        : baseChecks
            .filter((check) => check.state === "failure")
            .map((check) => check.name),
    baseRef: raw.baseRefName,
    behind: raw.mergeStateStatus === "BEHIND",
    changesRequestedBy: changesRequestedBy(raw),
    checks: headChecks ?? [],
    conflicting: raw.mergeable === "CONFLICTING",
    draft: raw.isDraft,
    headRef: raw.headRefName,
    lastComment:
      comment === undefined
        ? null
        : {
            asksQuestion: comment.body.includes("?"),
            author: person(comment.author),
          },
    number: raw.number,
    readFailed:
      errored ||
      headChecks === null ||
      raw.reviewThreads.nodes === null ||
      raw.latestOpinionatedReviews.nodes === null,
    repository: raw.repository.nameWithOwner,
    reviewDecision: reviewDecisionOf(raw.reviewDecision),
    threads: (raw.reviewThreads.nodes ?? [])
      .filter((thread) => thread !== null)
      .map(threadOf),
    title: raw.title,
  };
};

/** The one call this needs, narrowed so a test can supply one. */
export type FetchLike = (
  input: string,
  init: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "POST";
  }
) => Promise<{
  readonly json: () => Promise<object>;
  readonly ok: boolean;
  readonly status: number;
}>;

export interface OpenPullRequests {
  readonly facts: readonly PullRequestFacts[];
  /**
   * True when the listing stopped short: the page cap ended it, or GitHub
   * reported an error it could not pin to one pull request (an aborted query),
   * so pull requests may be missing.
   */
  readonly truncated: boolean;
}

/** An error path that starts at one hit of the search: `search.nodes[i]...`. */
const SEARCH_HIT_PATH = z.tuple(
  [z.literal("search"), z.literal("nodes"), z.int()],
  z.unknown()
);

interface Attribution {
  readonly aborted: boolean;
  readonly hits: ReadonlySet<number>;
}

/**
 * Splits a page's GraphQL errors into the search hits they name and the rest.
 * An error at `search.nodes[i]` leaves hit `i` incomplete, so that pull
 * request is read as failed; an error anywhere else cannot be pinned to a
 * pull request, so the listing as a whole is read as cut short.
 */
const attribute = (
  errors: readonly z.infer<typeof GRAPHQL_ERROR>[]
): Attribution => {
  const hits = new Set<number>();
  let aborted = false;
  for (const { path } of errors) {
    const hit = SEARCH_HIT_PATH.safeParse(path);
    if (hit.success) {
      hits.add(hit.data[2]);
    } else {
      aborted = true;
    }
  }
  return { aborted, hits };
};

/**
 * Lists the open pull requests a search finds, across pages, as facts.
 *
 * @remarks
 * Throws on anything but a usable answer: a digest built from nothing would
 * tell the maintainer nothing needs them when something does. Partial answers
 * are kept and labelled instead: a pull request GitHub reported an error
 * against comes back with `readFailed`, and a listing that stopped short comes
 * back `truncated`. A node that is not a pull request (the search type is
 * `ISSUE`, and the query is `is:pr`) comes back as an empty object and is
 * skipped.
 */
export const listOpenPullRequests = async (input: {
  readonly fetchImpl?: FetchLike;
  readonly query: string;
  readonly token: string;
}): Promise<OpenPullRequests> => {
  const { fetchImpl = fetch, query, token } = input;
  const facts: PullRequestFacts[] = [];
  let aborted = false;
  let after: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are sequential by nature
    const response = await fetchImpl(GRAPHQL_URL, {
      body: JSON.stringify({
        query: QUERY,
        variables: { after, pageSize: PAGE_SIZE, query },
      }),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `GitHub answered ${response.status} searching pull requests.`
      );
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are sequential by nature
    const parsed = PAGE.parse(await response.json());
    if (parsed.data === null) {
      const reasons = (parsed.errors ?? []).map(({ message }) => message);
      throw new Error(
        `GitHub could not search pull requests: ${reasons.join("; ") || "no data"}.`
      );
    }
    const errors = attribute(parsed.errors ?? []);
    aborted ||= errors.aborted;
    const { nodes, pageInfo } = parsed.data.search;
    for (const [index, node] of (nodes ?? []).entries()) {
      if ("number" in node) {
        facts.push(toFacts(PULL_REQUEST.parse(node), errors.hits.has(index)));
      }
    }
    if (!pageInfo.hasNextPage) {
      return { facts, truncated: aborted };
    }
    after = pageInfo.endCursor;
  }
  return { facts, truncated: true };
};
