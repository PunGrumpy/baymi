/**
 * Whether a review turn read anything before it answered.
 *
 * @remarks
 * A review is reasoning over code the agent read, and the diff in context
 * is a truncated summary, so a turn that answers without a single tool call
 * has seen a fragment of the change and none of the code around it. The
 * gateway's tool-call emulation produces exactly that turn; `docs/notes.md`
 * records how, and the four reviews on 2026-09-11 that ran this way, three
 * of which reported nothing needing attention.
 *
 * Two signals attest that the loop ran and {@link mayPostReview} accepts
 * either, because each can go missing on its own. `action.result` arrives
 * per settled tool call and per loaded skill, and a cold start loses the
 * ledger that collects them. eve's tool loop is the only thing that
 * advances `stepIndex`, which survives a channel that never receives
 * `action.result`. Neither signal looks at which tool ran; a rule naming a
 * particular tool would break on a rename.
 *
 * Loading the skill is not reading: on 2026-09-16 three reviews loaded it
 * and answered from the truncated diff (`docs/notes.md`). So a skill load
 * does not ground a turn, and the step escape asks for two steps.
 */

/** One settled action, in the shape `action.result` reports it. */
export interface ActionOutcome {
  readonly isError?: boolean;
  readonly kind?: string;
}

const SKILL_LOAD_KIND = "load-skill-result";

/** The skill load and one read. */
const STEPS_BEFORE_A_GROUNDED_REPLY = 2;

/** Only bounds what a warm runtime accumulates across unrelated sessions. */
const MAX_REMEMBERED_TURNS = 32;

interface TurnRecord {
  grounded: boolean;
  reported: boolean;
}

export interface GroundingLedger {
  readonly isGrounded: (turnId: string) => boolean;
  readonly note: (turnId: string, outcome: ActionOutcome) => void;
  /** True for the first caller only, so one turn sends one card. */
  readonly reportOnce: (turnId: string) => boolean;
}

/** In-memory and per-runtime; a cold start loses the record, which suppresses a review rather than posting one. */
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
      if (outcome.isError === true || outcome.kind === SKILL_LOAD_KIND) {
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

export const UNGROUNDED_REVIEW_CODE = "review_ungrounded";

export const NOT_A_REVIEW_CODE = "review_not_a_review";

/**
 * Whether the reply may be posted given the parser's verdict on it. A
 * turn can run its tools and still answer with something that is not a
 * review; on 2026-09-16 the model wrote a tool result in its own voice
 * (`docs/notes.md`). A person who asked still gets whatever it wrote.
 */
export const isReviewReply = (input: {
  readonly parsed: boolean;
  readonly unattended: boolean;
}): boolean => input.parsed || !input.unattended;

/**
 * Whether this reply may be posted on the pull request.
 *
 * @remarks
 * Only an unattended review is held to this. A person who mentions the
 * agent is owed an answer from whatever it has, and they can read the
 * answer and judge it; nobody reads the review before the author does.
 */
export const mayPostReview = (input: {
  readonly grounded: boolean;
  /** `stepIndex` of the completed message, which the tool loop advances. */
  readonly step: number;
  readonly unattended: boolean;
}): boolean =>
  input.grounded ||
  input.step >= STEPS_BEFORE_A_GROUNDED_REPLY ||
  !input.unattended;
