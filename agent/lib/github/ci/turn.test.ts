import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  chaseAuth,
  chaseBrief,
  ciTurn,
  encodeCiTurn,
  readCiTurn,
} from "#lib/github/ci/turn";
import type { CiTurn } from "#lib/github/ci/turn";
import {
  classifyPrincipal,
  isApp,
  isUnattended,
  memoryAccess,
} from "#lib/trust";

const turn = (overrides: Partial<CiTurn> = {}): CiTurn => ({
  attempt: 1,
  conclusion: "failure",
  evidence: "Error: connect ECONNRESET",
  headSha: "3c41196471a0ba382508ce887681b1403f1a47cd",
  job: "test",
  key: "pungrumpy/baymi#run77@1",
  kind: "flake",
  reason: "network",
  runId: 77,
  ...overrides,
});

/** What `defaultGitHubAuth` stamps on a CI event for the repository owner. */
const webhookAuth: SessionAuthContext = {
  attributes: {
    conversation_kind: "pull_request",
    delivery_id: "d-1",
    installation_id: "42",
    issue_number: "",
    pull_request_number: "7",
    repository: "PunGrumpy/baymi",
    repository_id: "1",
    user_login: "PunGrumpy",
    user_type: "User",
  },
  authenticator: "github-webhook",
  issuer: "github:PunGrumpy",
  principalId: "github:10858",
  principalType: "user",
  subject: "PunGrumpy",
};

describe("the facts a turn carries", () => {
  it("round-trips through the auth attributes", () => {
    const auth = chaseAuth(webhookAuth, turn());
    expect(readCiTurn(auth)).toStrictEqual(turn());
  });

  it.each(["base-unread", "breaks-caller"] as const)(
    "round-trips the reason %s, so the end of the turn can read it",
    (reason) => {
      const read = readCiTurn(chaseAuth(webhookAuth, turn({ reason })));
      expect(read?.reason).toBe(reason);
    }
  );

  it("round-trips an external check, which has no run", () => {
    const external = turn({
      kind: "external",
      reason: "external-check",
      runId: null,
    });
    expect(readCiTurn(chaseAuth(webhookAuth, external))).toStrictEqual(
      external
    );
  });

  it("is null for an auth that carries no chase, such as a schedule's", () => {
    expect(
      readCiTurn({
        attributes: {},
        authenticator: "app",
        principalId: "eve:app",
        principalType: "runtime",
      })
    ).toBeNull();
    expect(readCiTurn(null)).toBeNull();
  });

  it("is null when an attribute is not what the hook writes", () => {
    const attributes = { ...encodeCiTurn(turn()), ci_kind: "made-up" };
    expect(
      readCiTurn({
        ...webhookAuth,
        attributes: { ...webhookAuth.attributes, ...attributes },
      })
    ).toBeNull();
  });

  it("builds a turn from an assessment", () => {
    expect(
      ciTurn(
        {
          attempt: 2,
          classification: {
            files: [],
            kind: "flake",
            line: "boom",
            reason: "network",
          },
          conclusion: "failure",
          headSha: "abc",
          jobName: "test",
          pullRequest: 7,
          runId: 77,
        },
        "key"
      )
    ).toMatchObject({ attempt: 2, evidence: "boom", job: "test", key: "key" });
  });
});

describe(chaseAuth, () => {
  it("is the app: unattended, no memory write, not the maintainer", () => {
    const auth = chaseAuth(webhookAuth, turn());
    expect(classifyPrincipal(auth)).toBe("app");
    expect(isApp(auth)).toBeTruthy();
    expect(isUnattended(auth)).toBeTruthy();
    expect(memoryAccess(auth)).toBe("read");
  });

  it("keeps the pull request anchor and drops the sender", () => {
    const { attributes } = chaseAuth(webhookAuth, turn());
    expect(attributes.repository).toBe("PunGrumpy/baymi");
    expect(attributes.pull_request_number).toBe("7");
    expect(attributes.user_login).toBeUndefined();
    expect(attributes.user_type).toBeUndefined();
  });

  it("does not inherit the owner's principal when the owner pushed", () => {
    const auth = chaseAuth(webhookAuth, turn());
    expect(auth.principalId).toBe("eve:app");
    expect(auth.issuer).toBeUndefined();
    expect(auth.subject).toBeUndefined();
  });
});

describe(chaseBrief, () => {
  it("tells the model to rerun a flake once, and names the run", () => {
    const [brief] = chaseBrief(turn());
    expect(brief).toContain("Call `github__rerunWorkflowRun` once for run 77");
    expect(brief).toContain("flake (network)");
    expect(brief).toContain('"Error: connect ECONNRESET"');
  });

  it("tells it not to rerun anything else", () => {
    for (const changed of [
      { kind: "own-code" as const },
      { attempt: 2 },
      { runId: null },
    ]) {
      expect(chaseBrief(turn(changed))[0]).toContain("Do not rerun anything");
    }
  });

  it("forbids writing to the pull request and says the reply is discarded", () => {
    const [brief] = chaseBrief(turn());
    expect(brief).toContain("Do not comment on the pull request");
    expect(brief).toContain("Your final message is discarded");
  });

  it("hands an own-code failure to the chase tool, once, with the pull request and the failure", () => {
    const [brief] = chaseBrief(
      turn({ evidence: 'expected "5"', kind: "own-code" }),
      {
        number: 7,
        repository: "PunGrumpy/baymi",
      }
    );
    expect(brief).toContain(
      "Call `chase_pull_request` once with repository `PunGrumpy/baymi`, pullRequest 7, and failure \"test: expected '5'\""
    );
    expect(brief).toContain("Do not rerun anything");
  });

  it("does not mention the chase for any other kind", () => {
    const [brief] = chaseBrief(turn(), {
      number: 7,
      repository: "PunGrumpy/baymi",
    });
    expect(brief).not.toContain("chase_pull_request");
  });
});
