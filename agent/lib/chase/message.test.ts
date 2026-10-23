import { describe, expect, it } from "vitest";

import { commitMessageProblems } from "#lib/chase/message";

const GOOD = [
  "fix(math): add the second operand in sum",
  "",
  "`bun run test` failed in src/math.test.ts: expected sum(2, 3) to be 5,",
  "got 2. sum returned its first argument; it now adds both.",
].join("\n");

describe(commitMessageProblems, () => {
  it("accepts a Conventional Commit with a body", () => {
    expect(commitMessageProblems(GOOD)).toStrictEqual([]);
    expect(
      commitMessageProblems(
        "test: fix the fixture path\n\nThe test read a moved file."
      )
    ).toStrictEqual([]);
  });

  it("refuses a subject that is not a Conventional Commit", () => {
    expect(commitMessageProblems("Fix the test\n\nIt was broken.")[0]).toMatch(
      /not a Conventional Commit/u
    );
    expect(commitMessageProblems("fixed: thing\n\nbody")).toHaveLength(1);
  });

  it("refuses a long subject and a trailing period", () => {
    const long = `fix: ${"x".repeat(80)}`;
    expect(commitMessageProblems(`${long}\n\nbody`)).toStrictEqual([
      `The subject is ${long.length} characters, more than 72.`,
    ]);
    expect(commitMessageProblems("fix: add it.\n\nbody")).toStrictEqual([
      "The subject ends with a period.",
    ]);
  });

  it("refuses a message without a body after a blank line", () => {
    expect(commitMessageProblems("fix: add it")).toHaveLength(1);
    expect(commitMessageProblems("fix: add it\nbody right here")).toHaveLength(
      1
    );
    expect(commitMessageProblems("fix: add it\n\n  \n")).toHaveLength(1);
  });

  it("refuses co-author trailers and generated-by lines", () => {
    expect(
      commitMessageProblems(
        `${GOOD}\n\nCo-Authored-By: Someone <someone@example.com>`
      )
    ).toHaveLength(1);
    expect(
      commitMessageProblems(`${GOOD}\n\nGenerated with a tool`)
    ).toHaveLength(1);
    expect(commitMessageProblems(`${GOOD}\n\n🤖`)).toHaveLength(1);
  });
});
