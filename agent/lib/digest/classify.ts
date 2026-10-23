/**
 * Sorting an open pull request into what the maintainer has to do about it.
 *
 * @remarks
 * The rules are the engineering lead's orders (`agent/instructions/lead.ts`,
 * the `engineering-lead` skill) turned into a function of what GitHub
 * reported, so the digest never asks a model to re-derive a status from raw
 * JSON. Every pull request lands in exactly one bucket:
 *
 * - `needs-owner`: green and waiting on the maintainer's merge, a human
 *   question nobody answered, or a conflict only the author can resolve.
 * - `blocked`: failing CI, with a class, or bot review findings nobody
 *   triaged.
 * - `healthy`: everything else, reported as a number.
 *
 * Two of the lead's checks are not read at all. `Baymi security review`
 * reports and never gates, so the facts leave it out. A bot release pull
 * request (a bot author, and a release title or branch) is healthy unless its
 * CI fails.
 */

/** A person or bot on GitHub. */
export interface Person {
  readonly isBot: boolean;
  readonly login: string;
}

/** What one check or status came to, reduced to the three states that matter. */
export type CheckState = "failure" | "pending" | "success";

export interface CheckFact {
  readonly name: string;
  readonly state: CheckState;
  /** A runner timeout is the one failure that reads as a flake without a log. */
  readonly timedOut: boolean;
}

/** A review thread: who spoke last, and whether anyone but a bot ever did. */
export interface ThreadFact {
  readonly humanParticipated: boolean;
  readonly lastAuthor: Person | null;
  readonly outdated: boolean;
  readonly resolved: boolean;
}

export type ReviewDecision = "approved" | "changes-requested" | "none";

/** Everything the classifier reads about one pull request. */
export interface PullRequestFacts {
  readonly author: Person | null;
  /**
   * The names of the checks failing on the base branch's head, or `null` when
   * GitHub would not say. A check failing on the base too is not the diff's.
   */
  readonly baseFailingChecks: readonly string[] | null;
  readonly baseRef: string;
  readonly behind: boolean;
  /**
   * Everyone whose latest review of the pull request asks for changes, bots
   * included. Unlike `reviewDecision`, GitHub fills it in whether or not the
   * repository requires reviews.
   */
  readonly changesRequestedBy: readonly Person[];
  readonly checks: readonly CheckFact[];
  readonly conflicting: boolean;
  readonly draft: boolean;
  readonly headRef: string;
  /** The newest comment on the conversation, when a person wrote it. */
  readonly lastComment: {
    readonly author: Person | null;
    readonly asksQuestion: boolean;
  } | null;
  readonly number: number;
  /**
   * Whether GitHub did not hand over everything about this pull request: its
   * checks are missing or cut short, or it reported an error against it.
   * What is missing is not green.
   */
  readonly readFailed: boolean;
  readonly repository: string;
  readonly reviewDecision: ReviewDecision;
  readonly threads: readonly ThreadFact[];
  readonly title: string;
}

/** What the digest's reader needs to know about the people involved. */
export interface DigestContext {
  /** Logins of the maintainer, matched without regard to case. */
  readonly owners: readonly string[];
}

/**
 * What a failing check has in its favour, as a closed set. A check that fails
 * on the base branch's head too (`base`) is not the diff's. One that only
 * fails on other open pull requests (`siblings`) proves nothing about this
 * one: in a stack the pull requests above a culprit fail the same check
 * because they contain its commits, and a shared outage looks identical. With
 * neither, the check passes everywhere else, so the diff is the suspect
 * (`diff`), or `unknown` when the base could not be read. A runner timeout is
 * a `flake` without any of that.
 */
export type FailureClass = "base" | "diff" | "flake" | "siblings" | "unknown";

export type NeedsOwnerReason =
  | { readonly from: string; readonly kind: "changes-requested" }
  | { readonly kind: "conflict" }
  | { readonly from: string; readonly kind: "question" }
  | { readonly kind: "ready" };

export type BlockedReason =
  | {
      readonly behind: boolean;
      readonly checks: readonly string[];
      readonly failure: FailureClass;
      readonly kind: "ci";
      /**
       * For `siblings`, how many other open pull requests of the repository
       * fail the checks the base does not explain (the fewest, when there are
       * several); zero for every other class.
       */
      readonly peers: number;
    }
  | { readonly kind: "bot-findings"; readonly threads: number }
  | { readonly kind: "read-failed" };

export type HealthyReason =
  | "release"
  | "stacked"
  | "waiting-author"
  | "waiting-ci";

export type Verdict =
  | { readonly bucket: "blocked"; readonly reason: BlockedReason }
  | { readonly bucket: "healthy"; readonly reason: HealthyReason }
  | { readonly bucket: "needs-owner"; readonly reason: NeedsOwnerReason };

/** A classified pull request: just what the rendering and the key read. */
export interface Classified {
  readonly author: Person | null;
  readonly baseRef: string;
  readonly number: number;
  readonly repository: string;
  readonly verdict: Verdict;
}

/**
 * Bots that open release pull requests, by login. GitHub types `github-actions`
 * as a `Bot` already, and a `[bot]` login is one by name; the list covers a
 * fact built without either.
 */
const RELEASE_BOTS: ReadonlySet<string> = new Set([
  "dependabot",
  "github-actions",
  "renovate",
]);

const BOT_SUFFIX = /\[bot\]$/iu;

/**
 * The titles release tooling writes: changesets (`Version Packages`,
 * `chore: Version packages`), and release-please or a hand-run release
 * (`chore(release): ...`, `chore(main): release 1.2.3`, `chore: release`).
 */
const RELEASE_TITLE =
  /\bVersion Packages\b|^chore\(release\)|^chore(?:\([^)]*\))?:\s*release\b/iu;

/** The branches those tools open their pull requests from. */
const RELEASE_BRANCH = /^(?:changeset-release\/|release-please--)/iu;

const isBotAuthor = (author: Person | null): boolean =>
  author !== null &&
  (author.isBot ||
    BOT_SUFFIX.test(author.login) ||
    RELEASE_BOTS.has(author.login.toLowerCase()));

/**
 * A bot's release pull request, which the lead's orders call healthy. The
 * author has to be a bot: a person's pull request titled like a release is a
 * pull request like any other.
 */
const isBotRelease = (facts: PullRequestFacts): boolean =>
  isBotAuthor(facts.author) &&
  (RELEASE_TITLE.test(facts.title.trim()) ||
    RELEASE_BRANCH.test(facts.headRef.trim()));

const sameLogin = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

const isOwner = (person: Person, context: DigestContext): boolean =>
  context.owners.some((owner) => sameLogin(owner, person.login));

/** How many other pull requests must fail a check before it is called shared. */
const SHARED_FAILURE_PEERS = 2;

interface FailureEvidence {
  readonly failure: FailureClass;
  readonly peers: number;
}

/**
 * Why CI is red. A runner timeout reads as a flake. A check red on the base
 * branch too is the base's. A check red on other open pull requests of the
 * same repository, and green on the base, is neither's: its siblings failing
 * does not clear this diff. Any other red is the diff's, or unknown when the
 * base cannot be read and nothing else vouches for the check.
 */
const failureEvidence = (
  failing: readonly CheckFact[],
  baseFailing: readonly string[] | null,
  siblings: ReadonlyMap<string, number>
): FailureEvidence => {
  if (failing.every((check) => check.timedOut)) {
    return { failure: "flake", peers: 0 };
  }
  const onBase = new Set(baseFailing);
  const notOnBase = failing.filter((check) => !onBase.has(check.name));
  if (notOnBase.length === 0) {
    return { failure: "base", peers: 0 };
  }
  const peers = notOnBase.map((check) => siblings.get(check.name) ?? 0);
  if (peers.every((count) => count >= SHARED_FAILURE_PEERS)) {
    return { failure: "siblings", peers: Math.min(...peers) };
  }
  return { failure: baseFailing === null ? "unknown" : "diff", peers: 0 };
};

/**
 * The first person to be answered: an unresolved review thread whose last
 * word is a person other than the maintainer, or a last comment from one
 * that asks something.
 */
const unansweredQuestion = (
  facts: PullRequestFacts,
  context: DigestContext
): string | null => {
  for (const thread of facts.threads) {
    const author = thread.lastAuthor;
    if (
      !thread.resolved &&
      author !== null &&
      !author.isBot &&
      !isOwner(author, context)
    ) {
      return author.login;
    }
  }
  const comment = facts.lastComment;
  if (
    comment?.author &&
    comment.asksQuestion &&
    !comment.author.isBot &&
    !isOwner(comment.author, context)
  ) {
    return comment.author.login;
  }
  return null;
};

/**
 * The first person who asked for changes on the maintainer's own pull request,
 * and is still waiting. The author is the maintainer, so nobody else will
 * answer: this is a human question nobody answered, like an unresolved thread.
 * A bot's request is not a person waiting, and on someone else's pull request
 * the author owes the answer.
 */
const changesRequestedFromOwner = (
  facts: PullRequestFacts,
  context: DigestContext
): string | null => {
  if (facts.author === null || !isOwner(facts.author, context)) {
    return null;
  }
  const requester = facts.changesRequestedBy.find(
    (person) => !(person.isBot || isOwner(person, context))
  );
  return requester?.login ?? null;
};

/** Unresolved threads that only bots ever wrote in, on code that still exists. */
const untriagedBotThreads = (facts: PullRequestFacts): number =>
  facts.threads.filter(
    (thread) =>
      !(thread.resolved || thread.outdated || thread.humanParticipated) &&
      thread.lastAuthor?.isBot === true
  ).length;

const needsOwner = (reason: NeedsOwnerReason): Verdict => ({
  bucket: "needs-owner",
  reason,
});

const healthy = (reason: HealthyReason): Verdict => ({
  bucket: "healthy",
  reason,
});

/** What a pull request's neighbours say about it. */
export interface Relations {
  /**
   * For each check this pull request fails, how many other open pull requests
   * of the same repository fail it too.
   */
  readonly siblingFailures: ReadonlyMap<string, number>;
  /**
   * Whether another open pull request in the same repository has this one's
   * base as its head, which makes the base's merge the thing this one waits for.
   */
  readonly stackedOn: boolean;
}

/**
 * The bucket one pull request belongs to.
 *
 * @returns `null` for a draft, which the digest leaves out entirely.
 */
export const classifyPullRequest = (
  facts: PullRequestFacts,
  context: DigestContext,
  relations: Relations
): Verdict | null => {
  if (facts.draft) {
    return null;
  }
  const failing = facts.checks.filter((check) => check.state === "failure");
  let ci: Verdict | null = null;
  if (failing.length > 0) {
    ci = {
      bucket: "blocked",
      reason: {
        behind: facts.behind,
        checks: failing.map((check) => check.name),
        kind: "ci",
        ...failureEvidence(
          failing,
          facts.baseFailingChecks,
          relations.siblingFailures
        ),
      },
    };
  } else if (facts.readFailed) {
    // Nothing known to fail is not the same as nothing failing.
    ci = { bucket: "blocked", reason: { kind: "read-failed" } };
  }

  if (isBotRelease(facts)) {
    return ci ?? healthy("release");
  }
  if (facts.conflicting) {
    return facts.author?.isBot === true
      ? healthy("waiting-author")
      : needsOwner({ kind: "conflict" });
  }
  const asker = unansweredQuestion(facts, context);
  if (asker !== null) {
    return needsOwner({ from: asker, kind: "question" });
  }
  const requester = changesRequestedFromOwner(facts, context);
  if (requester !== null) {
    return needsOwner({ from: requester, kind: "changes-requested" });
  }
  if (ci !== null) {
    return ci;
  }
  const botThreads = untriagedBotThreads(facts);
  if (botThreads > 0) {
    return {
      bucket: "blocked",
      reason: { kind: "bot-findings", threads: botThreads },
    };
  }
  if (facts.checks.some((check) => check.state === "pending")) {
    return healthy("waiting-ci");
  }
  if (facts.reviewDecision === "changes-requested") {
    return healthy("waiting-author");
  }
  if (relations.stackedOn) {
    return healthy("stacked");
  }
  return needsOwner({ kind: "ready" });
};

const failingNames = (facts: PullRequestFacts): ReadonlySet<string> =>
  new Set(
    facts.checks
      .filter((check) => check.state === "failure")
      .map((check) => check.name)
  );

/**
 * For each repository, how many open pull requests fail each check.
 */
const failureCounts = (
  facts: readonly PullRequestFacts[]
): ReadonlyMap<string, ReadonlyMap<string, number>> => {
  const byRepository = new Map<string, Map<string, number>>();
  for (const entry of facts) {
    if (entry.draft) {
      continue;
    }
    const counts =
      byRepository.get(entry.repository) ?? new Map<string, number>();
    for (const name of failingNames(entry)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    byRepository.set(entry.repository, counts);
  }
  return byRepository;
};

/**
 * Classifies every pull request, leaves drafts out, and keeps the order GitHub
 * gave. A pull request is stacked when another one's head branch is its base,
 * in the same repository.
 */
export const classifyAll = (
  facts: readonly PullRequestFacts[],
  context: DigestContext
): readonly Classified[] => {
  const heads = new Set(
    facts.map((entry) => `${entry.repository}:${entry.headRef}`)
  );
  const counts = failureCounts(facts);
  const classified: Classified[] = [];
  for (const entry of facts) {
    const repositoryCounts = counts.get(entry.repository);
    const siblings = new Map<string, number>();
    for (const name of failingNames(entry)) {
      // The pull request itself is one of the failures counted.
      siblings.set(name, (repositoryCounts?.get(name) ?? 0) - 1);
    }
    const verdict = classifyPullRequest(entry, context, {
      siblingFailures: siblings,
      stackedOn: heads.has(`${entry.repository}:${entry.baseRef}`),
    });
    if (verdict !== null) {
      classified.push({
        author: entry.author,
        baseRef: entry.baseRef,
        number: entry.number,
        repository: entry.repository,
        verdict,
      });
    }
  }
  return classified;
};
