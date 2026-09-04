import { describe, expect, it } from "vitest";

import type { EscalationRequest } from "#lib/github/escalate";
import {
  ESCALATION_LABEL,
  escalateFailedTriage,
  escalationCalls,
} from "#lib/github/escalate";
import { MAINTAINER_GITHUB_LOGIN } from "#lib/trust";

/** A request that records what it was asked for and fails the named paths. */
const recorder = (failOn: readonly string[] = []) => {
  const paths: string[] = [];
  const request: EscalationRequest = ({ path }) => {
    paths.push(path);
    return failOn.includes(path)
      ? Promise.reject(new Error(`boom: ${path}`))
      : Promise.resolve();
  };
  return { paths, request };
};

const TARGET = {
  issueNumber: 12,
  owner: "pungrumpy",
  repo: "logixlysia",
} as const;

describe(escalationCalls, () => {
  it("creates the label, applies it, then assigns the maintainer", () => {
    // The order is the contract: a label cannot be applied before it exists,
    // and the assignment goes last because it is what reaches a person.
    expect(escalationCalls(TARGET).map((call) => call.path)).toStrictEqual([
      "/repos/pungrumpy/logixlysia/labels",
      "/repos/pungrumpy/logixlysia/issues/12/labels",
      "/repos/pungrumpy/logixlysia/issues/12/assignees",
    ]);
  });

  it("assigns the maintainer and nobody else", () => {
    const assign = escalationCalls(TARGET).at(-1);
    expect(assign?.body).toStrictEqual({
      assignees: [MAINTAINER_GITHUB_LOGIN],
    });
  });

  it("tolerates only the label that already exists", () => {
    expect(escalationCalls(TARGET).map((call) => call.tolerated)).toStrictEqual(
      [true, false, false]
    );
  });

  it("names the escalation label on both label calls", () => {
    const [create, apply] = escalationCalls(TARGET);
    expect(create?.body).toMatchObject({ name: ESCALATION_LABEL });
    expect(apply?.body).toStrictEqual({ labels: [ESCALATION_LABEL] });
  });
});

describe(escalateFailedTriage, () => {
  it("makes every call and reports nothing when they all land", async () => {
    const { paths, request } = recorder();
    await expect(escalateFailedTriage(request, TARGET)).resolves.toStrictEqual(
      []
    );
    expect(paths).toHaveLength(3);
  });

  it("stays quiet about a label that already exists", async () => {
    // The normal case after the first escalation: creating it answers 422.
    const { request } = recorder(["/repos/pungrumpy/logixlysia/labels"]);
    await expect(escalateFailedTriage(request, TARGET)).resolves.toStrictEqual(
      []
    );
  });

  it("still assigns when labelling fails", async () => {
    // Losing the label costs a filter; losing the assignment costs the whole
    // escalation, so an earlier failure must not skip a later step.
    const { paths, request } = recorder([
      "/repos/pungrumpy/logixlysia/issues/12/labels",
    ]);
    const failed = await escalateFailedTriage(request, TARGET);
    expect(paths).toContain("/repos/pungrumpy/logixlysia/issues/12/assignees");
    expect(failed).toStrictEqual([
      "/repos/pungrumpy/logixlysia/issues/12/labels",
    ]);
  });

  it("reports the assignment when it is the step that failed", async () => {
    const { request } = recorder([
      "/repos/pungrumpy/logixlysia/issues/12/assignees",
    ]);
    await expect(escalateFailedTriage(request, TARGET)).resolves.toStrictEqual([
      "/repos/pungrumpy/logixlysia/issues/12/assignees",
    ]);
  });
});
