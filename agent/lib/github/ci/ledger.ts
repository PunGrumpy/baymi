import type { RedEvent } from "#lib/github/ci/event";

/**
 * The idempotency key of a chase, and the record of which keys were used.
 *
 * @remarks
 * Delivery is at-least-once, and one failed run is announced many times: a
 * `workflow_run` and a `check_run` per job can name the same run. The key is
 * the run and its attempt, so attempt 2 is a new key and is chased, and a
 * redelivery of attempt 1 is not. An external check has no attempt, so its
 * check run id is the key.
 *
 * The record is in memory and per runtime, like the grounding ledger
 * (`#lib/github/grounding`): eve gives the app no store it may write. A cold
 * start or a second instance forgets, and the cost of forgetting is a second
 * turn, whose rerun the guard refuses by reading GitHub's attempt, and a
 * second line on Slack. `docs/notes.md` records the choice and the gap.
 */

/** Only bounds what a warm runtime accumulates. */
const MAX_REMEMBERED_KEYS = 256;

export const ciKey = (
  repository: { readonly owner: string; readonly repo: string },
  event: Pick<RedEvent, "attempt" | "eventId" | "kind">
): string => {
  const base = `${repository.owner}/${repository.repo}`.toLowerCase();
  return event.kind === "workflow-run"
    ? `${base}#run${event.eventId}@${event.attempt}`
    : `${base}#check${event.eventId}`;
};

interface KeyRecord {
  dispatched: boolean;
  reported: boolean;
}

export interface ChaseLedger {
  /** True for the first caller of a key only, so one failure starts one turn. */
  readonly claimDispatch: (key: string) => boolean;
  /** True for the first caller of a key only, so one failure is said once. */
  readonly claimReport: (key: string) => boolean;
}

export const createChaseLedger = (
  maxKeys: number = MAX_REMEMBERED_KEYS
): ChaseLedger => {
  // Insertion-ordered, so the first key is the oldest.
  const keys = new Map<string, KeyRecord>();
  const record = (key: string): KeyRecord => {
    const existing = keys.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const fresh: KeyRecord = { dispatched: false, reported: false };
    keys.set(key, fresh);
    if (keys.size > maxKeys) {
      const [oldest] = keys.keys();
      if (oldest !== undefined) {
        keys.delete(oldest);
      }
    }
    return fresh;
  };
  const claim = (key: string, field: keyof KeyRecord): boolean => {
    const entry = record(key);
    if (entry[field]) {
      return false;
    }
    entry[field] = true;
    return true;
  };
  return {
    claimDispatch: (key) => claim(key, "dispatched"),
    claimReport: (key) => claim(key, "reported"),
  };
};

/** The tool the chase asks the model to call, as eve names it: the extension's namespace, then the tool. */
export const RERUN_TOOL = "github__rerunWorkflowRun";

/** One settled action, in the shape `action.result` reports it. */
export interface ActionOutcome {
  readonly isError?: boolean;
  readonly status?: string;
  readonly toolName?: string;
}

export interface RerunRecord {
  /** Whether this turn's rerun call settled without an error. */
  readonly accepted: (turnId: string) => boolean;
  readonly note: (turnId: string, outcome: ActionOutcome) => void;
}

/**
 * Which turns saw their rerun call succeed.
 *
 * @remarks
 * A second witness beside GitHub's own attempt count (`./settle.ts` reads
 * both). Whether GitHub reports attempt 2 the moment it accepts a rerun is
 * unmeasured (`docs/notes.md`), and a lag would read as a rerun that never
 * happened. In memory and per runtime like the ledger above: a cold start
 * loses the record, and the attempt count is then the only witness.
 */
export const createRerunRecord = (
  maxTurns: number = MAX_REMEMBERED_KEYS
): RerunRecord => {
  const accepted = new Set<string>();
  return {
    accepted: (turnId) => accepted.has(turnId),
    note(turnId, outcome) {
      if (
        outcome.toolName !== RERUN_TOOL ||
        outcome.isError === true ||
        outcome.status !== "completed"
      ) {
        return;
      }
      accepted.add(turnId);
      if (accepted.size > maxTurns) {
        const [oldest] = accepted;
        if (oldest !== undefined) {
          accepted.delete(oldest);
        }
      }
    },
  };
};
