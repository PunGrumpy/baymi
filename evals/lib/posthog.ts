import type {
  AssertionResult,
  EveEvalResult,
  EveEvalRunSummary,
  EveEvalVerdict,
} from "eve/evals";

/**
 * The PostHog event name every eval result is recorded under.
 *
 * @remarks
 * One name for the whole suite, for the same reason `baymi_turn` is one name
 * for every turn: the thing being counted is an eval result. Which suite it
 * belongs to, which model answered, and which model graded are properties to
 * break down by, not three more event types.
 */
export const EVAL_EVENT = "baymi_eval";

/** What a run knows about itself that a single result cannot. */
export interface EvalRunMeta {
  /** The commit the run was made from, when CI supplies one. */
  readonly commitHash?: string;
  /** `EVAL_MODEL`, the model that graded `t.judge.*` assertions. */
  readonly judgeModel: string;
  /** `MODEL`, the model under test. */
  readonly model: string;
}

/**
 * Everything one eval result reports about itself.
 *
 * @remarks
 * Written out key by key rather than as an open dictionary, because these keys
 * are the contract: `usage.ts` reads the turn event's properties back by name
 * in a HogQL query, and anything charting these will do the same. A property
 * that only exists in the shape of an object literal is a column nobody can
 * find, and renaming one silently breaks whatever was reading it.
 *
 * The dotted names are deliberate. `evlog`'s PostHog drain writes literally
 * dotted property names (`recordShape: "compact"`), so a `baymi_eval` event
 * filters and breaks down beside a `baymi_turn` event instead of in a namespace
 * of its own.
 */
export interface EvalProperties {
  /** The model under test, matching `ai.model` on a turn event. */
  readonly "ai.model": string;
  /** The commit the run was made from, when CI supplied one. */
  readonly commitHash?: string;
  readonly "eval.assertions": number;
  readonly "eval.durationMs": number;
  /** Names of the assertions that did not pass; never their messages. */
  readonly "eval.failed": readonly string[];
  readonly "eval.gates": number;
  readonly "eval.gatesFailed": number;
  /** The path-derived eval id, e.g. `style/no-em-dash`. */
  readonly "eval.id": string;
  readonly "eval.judgeModel": string;
  /** Groups every result produced by one `eve eval` run. */
  readonly "eval.runId": string;
  /** Mean of the judged assertions, absent when none ran. */
  readonly "eval.softScore"?: number;
  readonly "eval.suite": string;
  readonly "eval.verdict": EveEvalVerdict;
}

/** One PostHog capture payload, in the shape the batch endpoint accepts. */
export interface EvalEvent {
  readonly distinct_id: string;
  readonly event: string;
  readonly properties: EvalProperties;
  readonly timestamp: string;
}

/** Four decimal places, which is finer than any judge threshold in `evals/`. */
const SCORE_PRECISION = 10_000;

/**
 * The suite an eval belongs to, taken from the first segment of its id.
 *
 * @remarks
 * eve derives an eval's id from its path, so `evals/style/no-em-dash.eval.ts`
 * arrives as `style/no-em-dash`. That first segment is already how the repo
 * groups evals on disk, which makes it the grouping a report should use rather
 * than inventing a second taxonomy in a tag. An eval at the root of `evals/`
 * has no segment to take, and is reported as `root`.
 */
export const suiteOf = (id: string): string => {
  const [suite, ...rest] = id.split("/");
  return rest.length > 0 && suite ? suite : "root";
};

/**
 * The mean of every soft assertion's score, or `undefined` when an eval
 * recorded none.
 *
 * @remarks
 * Gates and soft assertions answer different questions and averaging them
 * together answers neither. A gate is structural and binary: the tool was not
 * called, the turn succeeded. A soft assertion is the judge's 0-to-1 opinion of
 * the answer. Only the second is a quality score that can drift a little
 * between model versions, so only the second is averaged here; the gates are
 * reported as counts alongside it.
 *
 * `undefined` rather than `0` for an eval with no judged assertion, because a
 * zero would drag a suite average down as though the model had scored badly on
 * something it was never asked.
 */
export const softScore = (
  assertions: readonly AssertionResult[]
): number | undefined => {
  const scores = assertions
    .filter((assertion) => assertion.severity === "soft")
    .map((assertion) => assertion.score);
  if (scores.length === 0) {
    return;
  }
  const total = scores.reduce((sum, score) => sum + score, 0);
  return (
    Math.round((total / scores.length) * SCORE_PRECISION) / SCORE_PRECISION
  );
};

/**
 * The names of the assertions that did not pass.
 *
 * @remarks
 * Names only, never `message` or `metadata`. A failed judge assertion carries
 * the judge's prose about what the agent actually replied, and an eval prompt
 * is often a hostile issue body or a saved user preference; both are content,
 * and `agent/hooks/evlog.ts` already holds the line that this project's
 * telemetry records the shape of a run and not its text. An assertion name
 * (`succeeded`, `notCalledTool`, `judge.closedQA`) is structural, so it travels
 * and the reasoning stays in the console output and the `.eve/evals/`
 * artifacts, which never leave the machine.
 */
export const failedAssertions = (
  assertions: readonly AssertionResult[]
): string[] =>
  assertions
    .filter((assertion) => !assertion.passed)
    .map((assertion) => assertion.name);

/** {@link EvalProperties} while it is still being assembled. */
type MutableEvalProperties = {
  -readonly [K in keyof EvalProperties]: EvalProperties[K];
};

/**
 * The properties one eval result contributes.
 *
 * @remarks
 * The two optional keys are assigned rather than spread in, so a run with no
 * judged assertion and no commit omits them entirely instead of sending nulls.
 * PostHog treats an explicit null as a value a filter can match, which would
 * make "no judge ran" indistinguishable from "the judge returned nothing".
 */
const propertiesOf = (
  result: EveEvalResult,
  meta: EvalRunMeta,
  runId: string
): EvalProperties => {
  const gates = result.assertions.filter(
    (assertion) => assertion.severity === "gate"
  );
  const properties: MutableEvalProperties = {
    "ai.model": meta.model,
    "eval.assertions": result.assertions.length,
    "eval.durationMs":
      Date.parse(result.completedAt) - Date.parse(result.startedAt),
    "eval.failed": failedAssertions(result.assertions),
    "eval.gates": gates.length,
    "eval.gatesFailed": gates.filter((assertion) => !assertion.passed).length,
    "eval.id": result.id,
    "eval.judgeModel": meta.judgeModel,
    "eval.runId": runId,
    "eval.suite": suiteOf(result.id),
    "eval.verdict": result.verdict,
  };
  const score = softScore(result.assertions);
  if (score !== undefined) {
    properties["eval.softScore"] = score;
  }
  if (meta.commitHash) {
    properties.commitHash = meta.commitHash;
  }
  return properties;
};

/**
 * One event per eval result, ready for PostHog's batch endpoint.
 *
 * @remarks
 * The run's own start time is the `eval.runId`: it is already unique per run,
 * it sorts, and it needs no clock or random source of its own, which keeps this
 * function pure and therefore testable.
 *
 * `distinct_id` is the model under test rather than a person, because there is
 * no caller behind an eval run. That makes each model a PostHog person, so
 * "how did this model do" is a question the product can answer natively instead
 * of one that needs a breakdown every time.
 */
export const evalEvents = (
  summary: EveEvalRunSummary,
  meta: EvalRunMeta
): EvalEvent[] =>
  summary.results.map((result) => ({
    distinct_id: meta.model,
    event: EVAL_EVENT,
    properties: propertiesOf(result, meta, summary.startedAt),
    timestamp: result.completedAt,
  }));
