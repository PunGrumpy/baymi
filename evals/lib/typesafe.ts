/**
 * Jev as an AI SDK evaluation model, called on TypeSafe's own API.
 *
 * @remarks
 * Jev on AI Gateway needs paid credits, and TypeSafe has no AI SDK
 * provider, so this calls `POST /v1/systemone` with `TYPESAFE_API_KEY`
 * (`docs/notes.md`). The only translation is the yes/no question, which the
 * AI SDK calls `boolean` and TypeSafe calls `noul`. Answers arrive rounded
 * to two decimals. Retries are left to `evaluate`, which wraps every judge
 * call.
 */

import type { Experimental_EvaluationModel } from "ai";

type EvaluationModel = Exclude<Experimental_EvaluationModel, string>;
type CallOptions = Parameters<EvaluationModel["doEvaluate"]>[0];
type Result = Awaited<ReturnType<EvaluationModel["doEvaluate"]>>;
type Question = CallOptions["questions"][string];
type Answer = Result["answers"][string];

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** Rounding of every probability and score in a response. */
const DECIMALS = 2;

type WireAnswer =
  | { readonly type: "noul"; readonly noul: number }
  | {
      readonly choice: string;
      readonly probabilities: Record<string, number>;
      readonly type: "choice";
    }
  | {
      readonly probabilities: Record<string, number>;
      readonly score: number;
      readonly type: "score";
    };

interface WireResponse {
  readonly answers: Record<string, WireAnswer>;
  readonly model: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

const toWire = (question: Question) =>
  question.type === "boolean" ? { ...question, type: "noul" } : question;

const fromWire = (answer: WireAnswer): Answer => {
  switch (answer.type) {
    case "noul": {
      return { probability: answer.noul, type: "boolean" };
    }
    case "choice": {
      return {
        choice: answer.choice,
        probabilities: answer.probabilities,
        type: "choice",
      };
    }
    case "score": {
      return {
        probabilities: answer.probabilities,
        score: answer.score,
        type: "score",
      };
    }
    default: {
      throw new Error(
        `TypeSafe answered with an unknown question type: ${JSON.stringify(answer)}`
      );
    }
  }
};

export interface JevOptions {
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly modelId?: string;
}

export const jev = ({
  apiKey,
  fetch: send = fetch,
  modelId = "jev-latest",
}: JevOptions = {}): EvaluationModel => ({
  async doEvaluate({ abortSignal, headers, questions, state }) {
    const key = apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!key) {
      throw new Error("the eval judge needs TYPESAFE_API_KEY");
    }
    const response = await send(ENDPOINT, {
      body: JSON.stringify({
        model: modelId,
        questions: Object.fromEntries(
          Object.entries(questions).map(([id, question]) => [
            id,
            toWire(question),
          ])
        ),
        state,
      }),
      headers: {
        ...headers,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: abortSignal,
    });
    if (!response.ok) {
      throw new Error(
        `TypeSafe answered ${response.status}: ${await response.text()}`
      );
    }
    // SAFETY: a 200 from /v1/systemone has this documented shape, and
    // fromWire throws on any answer type it does not know.
    const body = (await response.json()) as WireResponse;
    return {
      answers: Object.fromEntries(
        Object.entries(body.answers).map(([id, answer]) => [
          id,
          fromWire(answer),
        ])
      ),
      response: { modelId: body.model },
      rounding: { probabilityDecimals: DECIMALS, scoreDecimals: DECIMALS },
      usage: {
        inputTokens: body.usage?.input_tokens,
        outputTokens: body.usage?.output_tokens,
      },
      warnings: [],
    };
  },
  modelId,
  provider: "typesafe",
  specificationVersion: "v4",
  supportedQuestionTypes: ["boolean", "choice", "score"],
});
