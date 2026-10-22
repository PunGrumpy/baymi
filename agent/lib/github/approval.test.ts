import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_WRITES,
  conversationWrite,
  GATED_WRITES,
  gatedWrite,
  RERUN_INPUT_DENIAL,
  RERUN_PRINCIPAL_DENIAL,
  RERUN_WRITES,
  rerunWrite,
  UNATTENDED_WRITE_DENIAL,
} from "#lib/github/approval";
import type { ReadGitHub } from "#lib/github/rerun";
import { GITHUB_WRITES } from "#lib/github/tools";
import { classifyPrincipal, REVIEWER_PRINCIPAL } from "#lib/trust";

const reviewer: SessionAuthContext = {
  attributes: {},
  authenticator: "github-webhook",
  principalId: REVIEWER_PRINCIPAL,
  principalType: "service",
};

// The principal eve gives a schedule fire, as measured on `eve dev`.
const app: SessionAuthContext = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

/** What `defaultGitHubAuth` mints for `login` on a repository `owner` owns. */
const gitHubPerson = (login: string, owner = "PunGrumpy") => ({
  attributes: { repository: `${owner}/baymi`, user_login: login },
  authenticator: "github-webhook",
  issuer: `github:${owner}`,
  principalId: "github:42",
  principalType: "user",
  subject: login,
});

// The repository's owner is the maintainer; anyone else it admitted is not.
const maintainer: SessionAuthContext = gitHubPerson("PunGrumpy");
const collaborator: SessionAuthContext = gitHubPerson("octocat");

// `localDev()` on the HTTP route, which `eve eval` also runs as.
const localDev: SessionAuthContext = {
  attributes: {},
  authenticator: "local-dev",
  principalId: "local-dev",
  principalType: "local-dev",
};

// A service the agent has no class for, such as a project-minted OIDC token.
const unknown: SessionAuthContext = {
  attributes: {},
  authenticator: "oidc",
  principalId: "https://oidc.vercel.com/baymi:project:baymi",
  principalType: "service",
};

describe("write classification", () => {
  it("covers every mounted write exactly once", () => {
    // A write with no policy falls back to an approval card, which an
    // unattended turn cannot answer. This is what keeps the lists honest.
    const classified = new Set<string>([
      ...CONVERSATION_WRITES,
      ...GATED_WRITES,
      ...RERUN_WRITES,
    ]);
    expect(classified).toStrictEqual(new Set<string>(GITHUB_WRITES));
    expect(
      CONVERSATION_WRITES.length + GATED_WRITES.length + RERUN_WRITES.length
    ).toBe(GITHUB_WRITES.length);
  });
});

describe(conversationWrite, () => {
  it("refuses an unattended turn with a reason the model can read", () => {
    expect(conversationWrite(reviewer)).toStrictEqual({
      reason: UNATTENDED_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("refuses the app on its own clock the same way", () => {
    expect(conversationWrite(app)).toStrictEqual({
      reason: UNATTENDED_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("runs uncarded for a person", () => {
    expect(conversationWrite(maintainer)).toBe("not-applicable");
  });
});

describe(gatedWrite, () => {
  it("refuses an unattended turn", () => {
    expect(gatedWrite(reviewer)).toStrictEqual({
      reason: UNATTENDED_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("refuses the app on its own clock", () => {
    expect(gatedWrite(app)).toStrictEqual({
      reason: UNATTENDED_WRITE_DENIAL,
      type: "denied",
    });
  });

  it("asks a person first", () => {
    expect(gatedWrite(maintainer)).toBe("user-approval");
    expect(gatedWrite(null)).toBe("user-approval");
  });
});

/** A GitHub whose run is on `attempt`, failed, on the pull request's head. */
const runOnAttempt =
  (attempt: number): ReadGitHub =>
  (path, schema) =>
    Promise.resolve(
      schema.parse(
        path.endsWith("/pulls/12")
          ? { head: { sha: "abc1234" } }
          : {
              conclusion: "failure",
              head_sha: "abc1234",
              pull_requests: [{ number: 12 }],
              run_attempt: attempt,
              status: "completed",
            }
      )
    );

const unreachable: ReadGitHub = () =>
  Promise.reject(new Error("a refused rerun must not ask GitHub"));

const rerunInput = {
  onlyFailedJobs: true,
  owner: "PunGrumpy",
  repo: "baymi",
  runId: 77,
};

describe(rerunWrite, () => {
  const denied = {
    reason: RERUN_PRINCIPAL_DENIAL,
    type: "denied",
  };

  it("runs uncarded for the maintainer when the guard passes", async () => {
    await expect(
      rerunWrite(maintainer, rerunInput, runOnAttempt(1))
    ).resolves.toBe("not-applicable");
  });

  it("runs uncarded for the app's schedule and CI turns when the guard passes", async () => {
    await expect(rerunWrite(app, rerunInput, runOnAttempt(1))).resolves.toBe(
      "not-applicable"
    );
  });

  it("holds the app to the guard: no card stands between it and a second attempt", async () => {
    // The app is unattended, so the guard is the only check on its rerun.
    const status = await rerunWrite(app, rerunInput, runOnAttempt(2));
    expect(status).toMatchObject({
      reason: expect.stringContaining("attempt 2"),
      type: "denied",
    });
  });

  it("refuses the reviewer without asking GitHub anything", async () => {
    await expect(
      rerunWrite(reviewer, rerunInput, unreachable)
    ).resolves.toStrictEqual(denied);
  });

  it("refuses a collaborator without asking GitHub anything", async () => {
    expect(classifyPrincipal(collaborator)).toBe("collaborator");
    await expect(
      rerunWrite(collaborator, rerunInput, unreachable)
    ).resolves.toStrictEqual(denied);
  });

  it("refuses a stranger without asking GitHub anything", async () => {
    expect(classifyPrincipal(unknown)).toBe("stranger");
    await expect(
      rerunWrite(unknown, rerunInput, unreachable)
    ).resolves.toStrictEqual(denied);
  });

  it("refuses a caller with no principal", async () => {
    await expect(
      rerunWrite(null, rerunInput, unreachable)
    ).resolves.toStrictEqual(denied);
  });

  it("refuses the operator's terminal, which the classifier calls the maintainer", async () => {
    // `eve eval` runs as `local-dev`: a session of it must not rerun a real
    // workflow on a real pull request.
    expect(classifyPrincipal(localDev)).toBe("maintainer");
    await expect(
      rerunWrite(localDev, rerunInput, unreachable)
    ).resolves.toStrictEqual(denied);
  });

  it("refuses an input that names no run", async () => {
    await expect(
      rerunWrite(maintainer, undefined, unreachable)
    ).resolves.toStrictEqual({
      reason: RERUN_INPUT_DENIAL,
      type: "denied",
    });
  });

  it("passes the guard's reason on when the run is on its second attempt", async () => {
    const status = await rerunWrite(maintainer, rerunInput, runOnAttempt(2));
    expect(status).toMatchObject({
      reason: expect.stringContaining("attempt 2"),
      type: "denied",
    });
  });
});
