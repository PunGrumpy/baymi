/**
 * How much chasing a day allows: a cap on chases per UTC day, one chase per
 * pull request head, and a bound on sandbox time per chase.
 *
 * @remarks
 * A chase runs a model for minutes and a sandbox for up to
 * {@link SANDBOX_BUDGET_MS}, both paid for, on a trigger nobody watches. The
 * guard is what keeps a run of red checks, or a fix that fails again on its
 * own new head, from spending the month. It claims before the chase starts
 * and never releases: a chase that failed still used its head and its slot.
 *
 * The store is behind {@link BudgetStore} so the rule is tested without one.
 * A store that cannot answer refuses the chase: no record means no chase,
 * never an unbounded one. Which store production uses, and why, is in
 * `docs/notes.md`.
 */

/** Chases per UTC day, across every repository. */
export const DAILY_CHASES = 3;

/** A chase stops and reports what it has once its sandbox has run this long. */
export const SANDBOX_BUDGET_MS = 25 * 60 * 1000;

/** The UTC day a moment falls on, `YYYY-MM-DD`. */
export const utcDay = (now: number): string =>
  new Date(now).toISOString().slice(0, 10);

/** One pull request head, the unit the per-head rule counts. */
export const headKey = (repository: string, sha: string): string =>
  `${repository.toLowerCase()}@${sha}`;

/** What a store holds for one day: the heads chased, in order. */
export interface BudgetLedger {
  readonly day: string;
  readonly heads: readonly string[];
}

export type ClaimVerdict = "claimed" | "daily-cap" | "head-chased";

export interface BudgetClaim {
  readonly cap: number;
  readonly day: string;
  readonly head: string;
}

/** A claim's verdict, and the ledger to keep after it. */
export interface ClaimDecision {
  readonly ledger: BudgetLedger | null;
  readonly verdict: ClaimVerdict;
}

/**
 * The rule, on a ledger: a head already in today's ledger is refused, and so
 * is any head once the day holds `cap` of them. A ledger from another day
 * counts as empty.
 */
export const decideClaim = (
  ledger: BudgetLedger | null,
  claim: BudgetClaim
): ClaimDecision => {
  const today =
    ledger?.day === claim.day ? ledger : { day: claim.day, heads: [] };
  if (today.heads.includes(claim.head)) {
    return { ledger, verdict: "head-chased" };
  }
  if (today.heads.length >= claim.cap) {
    return { ledger, verdict: "daily-cap" };
  }
  return {
    ledger: { day: claim.day, heads: [...today.heads, claim.head] },
    verdict: "claimed",
  };
};

/**
 * Where the ledger lives. `claim` reads, decides and records in one step, and
 * throws when the store cannot be read or written.
 */
export interface BudgetStore {
  readonly claim: (claim: BudgetClaim) => Promise<ClaimVerdict>;
}

/**
 * A ledger in this runtime's memory.
 *
 * @remarks
 * Nothing awaits between the read and the write, so two chases claiming at
 * once in one runtime cannot both take the last slot.
 */
export const createMemoryBudgetStore = (): BudgetStore => {
  let ledger: BudgetLedger | null = null;
  return {
    claim: (claim) => {
      const decided = decideClaim(ledger, claim);
      ({ ledger } = decided);
      return Promise.resolve(decided.verdict);
    },
  };
};

export type BudgetVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "daily-cap" | "head-chased" | "store-unreadable";
    };

/** Claims a chase for one head now, and fails closed on a store that cannot answer. */
export const claimChase = async (
  store: BudgetStore,
  input: {
    readonly cap?: number;
    readonly head: string;
    readonly now: number;
  }
): Promise<BudgetVerdict> => {
  let verdict: ClaimVerdict;
  try {
    verdict = await store.claim({
      cap: input.cap ?? DAILY_CHASES,
      day: utcDay(input.now),
      head: input.head,
    });
  } catch {
    return { ok: false, reason: "store-unreadable" };
  }
  return verdict === "claimed" ? { ok: true } : { ok: false, reason: verdict };
};

/** What is left of a chase's sandbox time, in milliseconds; zero or less when spent. */
export const budgetLeftMs = (startedAt: number, now: number): number =>
  SANDBOX_BUDGET_MS - (now - startedAt);

/** Why the guard refused, in words the result carries. */
export const BUDGET_REFUSALS: Readonly<
  Record<Exclude<BudgetVerdict, { ok: true }>["reason"], string>
> = {
  "daily-cap": `Today's ${DAILY_CHASES} chases are used up.`,
  "head-chased": "This head was chased already.",
  "store-unreadable": "The chase ledger could not be read, so no chase ran.",
};
