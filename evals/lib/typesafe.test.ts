import { describe, expect, it } from "vitest";

import { jev } from "./typesafe";

/** A response the API returned on 2026-10-19, trimmed to the fields read. */
const RESPONSE = {
  answers: {
    b: { noul: 0.99, type: "noul" },
    c: {
      choice: "geography",
      confidence: 1,
      probabilities: { geography: 1, math: 0 },
      type: "choice",
    },
    s: {
      confidence: 0.98,
      legend: { "0": "verbose", "1": "ok", "2": "concise" },
      probabilities: { "0": 0, "1": 0.01, "2": 0.99 },
      score: 1.99,
      type: "score",
    },
  },
  model: "jev-1.13.0",
  usage: { input_tokens: 354, output_tokens: 67 },
};

const recording = (response: Response) => {
  const requests: { body: unknown; headers: Headers }[] = [];
  const send: typeof fetch = (_input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(response);
  };
  return { requests, send };
};

const QUESTIONS = {
  b: { instructions: "Is the statement correct?", type: "boolean" },
  c: {
    criteria: { geography: null, math: "numbers" },
    instructions: "Which topic?",
    type: "choice",
  },
  s: {
    criteria: ["verbose", "ok", "concise"],
    instructions: "How concise?",
    type: "score",
  },
} as const;

describe(jev, () => {
  it("asks a boolean question as noul and reads every answer back", async () => {
    const { requests, send } = recording(Response.json(RESPONSE));
    const result = await jev({ apiKey: "test", fetch: send }).doEvaluate({
      questions: QUESTIONS,
      state: "The capital of France is Paris.",
    });

    expect(requests[0]?.body).toStrictEqual({
      model: "jev-latest",
      questions: { ...QUESTIONS, b: { ...QUESTIONS.b, type: "noul" } },
      state: "The capital of France is Paris.",
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer test");
    expect(result.answers).toStrictEqual({
      b: { probability: 0.99, type: "boolean" },
      c: {
        choice: "geography",
        probabilities: { geography: 1, math: 0 },
        type: "choice",
      },
      s: {
        probabilities: { "0": 0, "1": 0.01, "2": 0.99 },
        score: 1.99,
        type: "score",
      },
    });
    expect(result.usage).toStrictEqual({ inputTokens: 354, outputTokens: 67 });
    expect(result.response?.modelId).toBe("jev-1.13.0");
  });

  it("fails with the status and body when the API refuses", async () => {
    const { send } = recording(new Response("bad key", { status: 401 }));
    await expect(
      jev({ apiKey: "test", fetch: send }).doEvaluate({
        questions: QUESTIONS,
        state: "x",
      })
    ).rejects.toThrow("TypeSafe answered 401: bad key");
  });
});
