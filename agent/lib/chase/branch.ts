/**
 * Where a chase's fix goes: onto the pull request's own branch, or into a
 * pull request against it, and never anywhere else.
 *
 * @remarks
 * The chase was handed one pull request, so the one branch it may change is
 * that pull request's head, and only when the branch lives in the same
 * repository, is not the default branch, and is not protected.
 * Whether the App may write at all is not decided here: the repository's
 * `permissions` field describes a person and reads all-false for an
 * installation token (`docs/notes.md`), so a 403 on the push is what says
 * so (`./deliver.ts`). A protected
 * or default branch gets a pull request from a `baymi/chase/` branch instead,
 * and a fork gets nothing: its branch is in a repository the App is not
 * installed on, so it can neither push there nor open a pull request into it.
 * The push itself is a fast-forward (`./commit.ts`), so nothing here can
 * rewrite a branch's history.
 */

/** Every branch a chase creates starts with this. */
export const CHASE_BRANCH_PREFIX = "baymi/chase/";

const SHORT_SHA = 7;

/** `baymi/chase/<pr>-<short head sha>`: one per pull request head. */
export const chaseBranchName = (pullRequest: number, headSha: string): string =>
  `${CHASE_BRANCH_PREFIX}${pullRequest}-${headSha.slice(0, SHORT_SHA)}`;

/** What GitHub says about the branch the fix is for. */
export interface BranchFacts {
  /** `owner/repo` of the pull request's base. */
  readonly baseRepository: string;
  readonly defaultBranch: string;
  /** Whether the head branch has a protection rule. */
  readonly headProtected: boolean;
  readonly headRef: string;
  /** `owner/repo` of the head, or `null` when its fork was deleted. */
  readonly headRepository: string | null;
  readonly headSha: string;
  readonly pullRequest: number;
}

export type PushPlan =
  | { readonly branch: string; readonly kind: "push" }
  | {
      readonly base: string;
      readonly branch: string;
      readonly kind: "pull-request";
    }
  | { readonly kind: "refuse"; readonly reason: "fork" };

/** Decides where the fix goes, before anything is pushed. */
export const planPush = (facts: BranchFacts): PushPlan => {
  const sameRepository =
    facts.headRepository !== null &&
    facts.headRepository.toLowerCase() === facts.baseRepository.toLowerCase();
  if (!sameRepository) {
    return { kind: "refuse", reason: "fork" };
  }
  if (facts.headProtected || facts.headRef === facts.defaultBranch) {
    return {
      base: facts.headRef,
      branch: chaseBranchName(facts.pullRequest, facts.headSha),
      kind: "pull-request",
    };
  }
  return { branch: facts.headRef, kind: "push" };
};

/**
 * The plan after GitHub refused a push to the head branch: a pull request
 * against it, for a rule `planPush` could not see.
 */
export const fallBackToPullRequest = (facts: BranchFacts): PushPlan => ({
  base: facts.headRef,
  branch: chaseBranchName(facts.pullRequest, facts.headSha),
  kind: "pull-request",
});

/** Why nothing was pushed, in words the result carries. */
export const REFUSAL_REASONS = {
  fork: "The head branch is in a fork, where the App can neither push nor open a pull request.",
  "no-write":
    "GitHub refused the App's push with 403: it cannot write to this repository.",
} as const satisfies Readonly<
  Record<Extract<PushPlan, { kind: "refuse" }>["reason"] | "no-write", string>
>;
