import type { RedEvent } from "#lib/github/ci/event";
import type { CiTurn } from "#lib/github/ci/turn";
import { parseRerunInput } from "#lib/github/rerun";

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

/** One tool call, in the shape `actions.requested` reports it. */
export interface ToolCall {
  readonly callId: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- eve types a call's input as a JSON object, and `parseRerunInput` is where it is parsed
  readonly input: Readonly<Record<string, unknown>>;
  readonly toolName: string;
}

export interface RerunRecord {
  /** Whether the chase with this key saw its own rerun call succeed. */
  readonly accepted: (key: string) => boolean;
  /** `actions.requested`: a call the turn made, kept if it reruns the chase's own run. */
  readonly requested: (
    sessionId: string,
    call: ToolCall,
    turn: Pick<CiTurn, "attempt" | "key"> | null
  ) => void;
  /** `action.result`: how a call settled. */
  readonly settled: (
    sessionId: string,
    result: ActionOutcome & { readonly callId: string }
  ) => void;
}

/**
 * Which chases saw their rerun call succeed, keyed by the chase: the run and
 * the attempt that failed.
 *
 * @remarks
 * A second witness beside GitHub's own attempt count (`./settle.ts` reads
 * both). Whether GitHub reports attempt 2 the moment it accepts a rerun is
 * unmeasured (`docs/notes.md`), and a lag would read as a rerun that never
 * happened.
 *
 * eve's turn id is `turn_<n>`, unique only within a session, and every
 * chase's session starts at the same one, so a record keyed by it let one
 * pull request's rerun silence another's line. The run comes from the call's
 * own input, read at `actions.requested`, and is joined to its result by the
 * call id within the session (a model's call ids can repeat across
 * sessions). A call that reruns a run other than the chase's is not
 * recorded: it says nothing about this chase. In memory and per runtime like
 * the ledger above: a cold start loses the record, and the attempt count is
 * then the only witness.
 */
export const createRerunRecord = (
  maxKeys: number = MAX_REMEMBERED_KEYS
): RerunRecord => {
  const pending = new Map<string, string>();
  const accepted = new Set<string>();
  // Insertion-ordered, so the first key is the oldest.
  const bound = (keys: Map<string, string> | Set<string>): void => {
    if (keys.size > maxKeys) {
      const [oldest] = keys.keys();
      if (oldest !== undefined) {
        keys.delete(oldest);
      }
    }
  };
  return {
    accepted: (key) => accepted.has(key),
    requested(sessionId, call, turn) {
      if (turn === null || call.toolName !== RERUN_TOOL) {
        return;
      }
      const run = parseRerunInput(call.input);
      if (run === null) {
        return;
      }
      const key = ciKey(run, {
        attempt: turn.attempt,
        eventId: run.runId,
        kind: "workflow-run",
      });
      if (key !== turn.key) {
        return;
      }
      const id = `${sessionId}:${call.callId}`;
      pending.set(id, key);
      bound(pending);
    },
    settled(sessionId, result) {
      const id = `${sessionId}:${result.callId}`;
      const key = pending.get(id);
      if (key === undefined) {
        return;
      }
      pending.delete(id);
      if (result.isError === true || result.status !== "completed") {
        return;
      }
      accepted.add(key);
      bound(accepted);
    },
  };
};
