import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { FetchLike } from "#lib/github/installation";
import {
  checkRerun,
  githubReader,
  parseRerunInput,
  RERUNNABLE_CONCLUSIONS,
} from "#lib/github/rerun";
import type { ReadGitHub, RerunInput } from "#lib/github/rerun";

interface RunFixture {
  conclusion: string | null;
  head_sha: string;
  pull_requests: { number: number }[];
  run_attempt: number;
  status: string;
}

/** What the fetch stub saw, for the test to read back. */
interface Seen {
  headers: Readonly<Record<string, string>>;
  url: string;
}

const answer = (ok: boolean, status: number, body: Record<string, number>) => ({
  json: () => Promise.resolve(body),
  ok,
  status,
});

const token = () => Promise.resolve("tok");

const input: RerunInput = { owner: "PunGrumpy", repo: "baymi", runId: 77 };
const RUN_PATH = "/repos/PunGrumpy/baymi/actions/runs/77";
const PULL_PATH = "/repos/PunGrumpy/baymi/pulls/12";

/**
 * A GitHub that answers from a mutable record, so a test can let the first
 * call happen and then show the second what GitHub reports afterwards.
 */
const fakeGitHub = (
  overrides: Partial<RunFixture> = {},
  pullHead = "aaaaaaa1111111"
) => {
  const run: RunFixture = {
    conclusion: "failure",
    head_sha: "aaaaaaa1111111",
    pull_requests: [{ number: 12 }],
    run_attempt: 1,
    status: "completed",
    ...overrides,
  };
  const reads: string[] = [];
  const read: ReadGitHub = (path, schema) => {
    reads.push(path);
    if (path === RUN_PATH) {
      return Promise.resolve(schema.parse(run));
    }
    if (path === PULL_PATH) {
      return Promise.resolve(schema.parse({ head: { sha: pullHead } }));
    }
    return Promise.reject(new Error(`unexpected read ${path}`));
  };
  return { read, reads, run };
};

const failing: ReadGitHub = () => Promise.reject(new Error("503"));

const unrecognizedAnswer: ReadGitHub = (_path, schema) =>
  Promise.resolve(schema.parse({ status: 1 }));

/** Why the guard refused, or an empty string when it did not. */
const reasonFor = async (read: ReadGitHub): Promise<string> => {
  const verdict = await checkRerun(input, read);
  return verdict.ok ? "" : verdict.reason;
};

describe("a rerun is allowed", () => {
  it("for the first attempt of a failed run on the pull request's head", async () => {
    const { read } = fakeGitHub();
    await expect(checkRerun(input, read)).resolves.toStrictEqual({ ok: true });
  });

  it("for every conclusion the guard calls a failure", async () => {
    const verdicts = await Promise.all(
      RERUNNABLE_CONCLUSIONS.map((conclusion) =>
        checkRerun(input, fakeGitHub({ conclusion }).read)
      )
    );
    expect(verdicts).toStrictEqual([{ ok: true }, { ok: true }]);
  });
});

describe("a rerun is refused", () => {
  it("on the second attempt, and says why", async () => {
    const reason = await reasonFor(fakeGitHub({ run_attempt: 2 }).read);
    expect(reason).toContain("attempt 2");
  });

  it("for a run that passed", async () => {
    const reason = await reasonFor(fakeGitHub({ conclusion: "success" }).read);
    expect(reason).toContain("success");
  });

  it("for a run someone cancelled, which is not a flake", async () => {
    const reason = await reasonFor(
      fakeGitHub({ conclusion: "cancelled" }).read
    );
    expect(reason).toContain("cancelled");
  });

  it("for a run that has not finished", async () => {
    const reason = await reasonFor(
      fakeGitHub({ conclusion: null, status: "in_progress" }).read
    );
    expect(reason).toContain("in_progress");
  });

  it("when the pull request has moved past the commit the run ran", async () => {
    const reason = await reasonFor(fakeGitHub({}, "bbbbbbb2222222").read);
    expect(reason).toContain("aaaaaaa");
    expect(reason).toContain("bbbbbbb");
  });

  it("when the run belongs to no open pull request, without reading a pull request", async () => {
    const { read, reads } = fakeGitHub({ pull_requests: [] });
    await expect(reasonFor(read)).resolves.toContain("no open pull request");
    expect(reads).toStrictEqual([RUN_PATH]);
  });

  it("when GitHub cannot be read, because a guess is not a check", async () => {
    await expect(reasonFor(failing)).resolves.toContain("not rerun");
  });

  it("when GitHub answers in a shape the guard does not know", async () => {
    await expect(reasonFor(unrecognizedAnswer)).resolves.toContain("not rerun");
  });
});

describe("a duplicated call for the same run", () => {
  it("is refused the second time, because GitHub reports attempt 2 by then", async () => {
    // Queue delivery is at-least-once: the turn that asked for the rerun can
    // run again, and the model asks again with the same run id. Nothing in
    // this runtime remembers the first call; GitHub does.
    const { read, run } = fakeGitHub();

    await expect(checkRerun(input, read)).resolves.toStrictEqual({ ok: true });
    // The first call went through, and GitHub now counts the new attempt.
    run.run_attempt = 2;
    run.status = "in_progress";
    run.conclusion = null;

    const second = await checkRerun(input, read);
    expect(second.ok).toBeFalsy();
  });

  it("is refused on attempt 2 even once that attempt has failed too", async () => {
    const { read, run } = fakeGitHub();
    run.run_attempt = 2;
    await expect(reasonFor(read)).resolves.toContain("attempt 2");
  });
});

describe(parseRerunInput, () => {
  it("accepts the tool's input, extra fields and all", () => {
    expect(parseRerunInput({ ...input, onlyFailedJobs: true })).toStrictEqual(
      input
    );
  });

  it("refuses what is not a number or a plain name", () => {
    expect(parseRerunInput()).toBeNull();
    expect(parseRerunInput({ ...input, runId: "77" })).toBeNull();
    expect(parseRerunInput({ ...input, runId: 0 })).toBeNull();
    expect(parseRerunInput({ ...input, owner: "../orgs" })).toBeNull();
    expect(parseRerunInput({ ...input, repo: "a/b" })).toBeNull();
  });
});

describe(githubReader, () => {
  it("reads a path with the token and the API version, and parses the body", async () => {
    const seen: Seen = { headers: {}, url: "" };
    const fetchImpl: FetchLike = (url, init) => {
      seen.headers = init.headers;
      seen.url = url;
      return Promise.resolve(answer(true, 200, { ok: 1 }));
    };

    const body = await githubReader(token, fetchImpl)(
      RUN_PATH,
      z.object({ ok: z.number() })
    );

    expect(body).toStrictEqual({ ok: 1 });
    expect(seen.url).toBe(`https://api.github.com${RUN_PATH}`);
    expect(seen.headers.authorization).toBe("Bearer tok");
    expect(seen.headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("throws on a non-2xx answer instead of returning its body", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(answer(false, 403, { message: 0 }));
    await expect(
      githubReader(token, fetchImpl)(RUN_PATH, z.object({}))
    ).rejects.toThrow("403");
  });
});
