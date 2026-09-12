/**
 * Whether a review turn actually read anything before it answered.
 *
 * @remarks
 * A review is reasoning over code the agent went and read: the skill holds
 * the procedure, and `read_file`, `glob` and `grep` hold the checkout. The
 * diff in context is a summary and is capped (eve truncates the patches at
 * 20 KB and says so), so a turn that answers without a single tool call has
 * seen a fragment of a large pull request and none of the code around it.
 *
 * That turn is not hypothetical. The gateway this agent answers through
 * emulates tool calling for models that do not speak it natively, and the
 * emulation fails often enough to matter: the model's call arrives as
 * literal text in the reply rather than as a tool call, eve sees a finished
 * message, and the channel posts it. Observed on four consecutive reviews on
 * 2026-09-11, three of which read "nothing here needs security attention".
 * A review that never ran must not be able to say that, which is the same
 * rule `reportFailedReview` already applies to a review that died.
 *
 * The evidence is `action.result`: eve emits one per settled tool call and
 * per loaded skill. At least one that is not an error means the loop ran.
 * Nothing here inspects which tool it was; the failure this guards against
 * produces no results at all, and a stricter rule (this named skill, that
 * named tool) would suppress good reviews whenever eve renamed a field.
 *
 * `stepIndex` on the reply says the same thing from the other side, and
 * {@link mayPostReview} accepts either. eve advances the step only in
 * `tool-loop.js`, where the loop continues past a settled tool result, so a
 * reply at step 0 never ran one; a turn that answers before calling a tool
 * emits its text as a message boundary and does not advance. Two signals
 * because they fail apart: the ledger is lost across a cold start, and the
 * step count survives a channel that never receives `action.result`.
 */

/** One settled action, in the shape `action.result` reports it. */
export interface ActionOutcome {
  readonly isError?: boolean;
  readonly kind?: string;
}

/**
 * Turns remembered at once. A review is one turn of one session, so this
 * only bounds what a warm runtime accumulates across unrelated sessions.
 */
const MAX_REMEMBERED_TURNS = 32;

interface TurnRecord {
  /** The turn settled at least one action without error. */
  grounded: boolean;
  /** A suppressed reply was already carded for this turn. */
  reported: boolean;
}

/** What this runtime knows about the turns it has seen. */
export interface GroundingLedger {
  /** Whether this turn has settled at least one action without error. */
  readonly isGrounded: (turnId: string) => boolean;
  /** Records one settled action against the turn that produced it. */
  readonly note: (turnId: string, outcome: ActionOutcome) => void;
  /**
   * Claims the one report a suppressed turn is allowed. True for the first
   * caller and false for every later one, so a turn that ends in two
   * completed messages still sends a single card.
   */
  readonly reportOnce: (turnId: string) => boolean;
}

/**
 * A ledger of which turns ran their tools.
 *
 * @remarks
 * In-memory and per-runtime, which is all it needs to be: the events it
 * reads and the reply it gates arrive in the same invocation. A cold start
 * between them loses the record and suppresses one review into the Slack
 * card, which is the safe direction to fail.
 */
export const createGroundingLedger = (
  maxTurns: number = MAX_REMEMBERED_TURNS
): GroundingLedger => {
  // Insertion-ordered, so the first key is the oldest turn.
  const turns = new Map<string, TurnRecord>();
  const record = (turnId: string): TurnRecord => {
    const existing = turns.get(turnId);
    if (existing !== undefined) {
      return existing;
    }
    const fresh: TurnRecord = { grounded: false, reported: false };
    turns.set(turnId, fresh);
    if (turns.size > maxTurns) {
      const [oldest] = turns.keys();
      if (oldest !== undefined) {
        turns.delete(oldest);
      }
    }
    return fresh;
  };
  return {
    isGrounded(turnId) {
      return turns.get(turnId)?.grounded === true;
    },
    note(turnId, outcome) {
      if (outcome.isError === true) {
        return;
      }
      record(turnId).grounded = true;
    },
    reportOnce(turnId) {
      const turn = record(turnId);
      if (turn.reported) {
        return false;
      }
      turn.reported = true;
      return true;
    },
  };
};

/** The code the suppressed review is logged and carded under. */
export const UNGROUNDED_REVIEW_CODE = "review_ungrounded";

/**
 * Whether this reply may be posted on the pull request.
 *
 * @remarks
 * Only an unattended review is held to this. A person who mentions the
 * agent is owed an answer from whatever it has, and they can read the
 * answer and judge it; nobody reads the review before the author does.
 */
export const mayPostReview = (input: {
  /** The turn settled an action, per the ledger. */
  readonly grounded: boolean;
  /** `stepIndex` of the completed message, which the tool loop advances. */
  readonly step: number;
  readonly unattended: boolean;
}): boolean => input.grounded || input.step > 0 || !input.unattended;
