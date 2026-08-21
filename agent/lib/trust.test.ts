import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  AUTONOMOUS_GITHUB_PRINCIPAL,
  isAutonomous,
  isScheduleAppAuth,
  isTrustedGitHubAssociation,
} from "#lib/trust";

/** An issue payload with the optional fields GitHub can omit left off. */
interface PartialIssuePayload {
  readonly author_association?: string;
}

/** A session whose auth context has not been resolved yet. */
interface PartialSession {
  readonly auth?: SessionAuthContext | null;
}

describe(isTrustedGitHubAssociation, () => {
  it("trusts the roles that carry repository write access", () => {
    expect(isTrustedGitHubAssociation("OWNER")).toBeTruthy();
    expect(isTrustedGitHubAssociation("MEMBER")).toBeTruthy();
    expect(isTrustedGitHubAssociation("COLLABORATOR")).toBeTruthy();
  });

  it("does not trust roles a public repo hands out for free", () => {
    expect(isTrustedGitHubAssociation("CONTRIBUTOR")).toBeFalsy();
    expect(isTrustedGitHubAssociation("FIRST_TIME_CONTRIBUTOR")).toBeFalsy();
    expect(isTrustedGitHubAssociation("NONE")).toBeFalsy();
    expect(isTrustedGitHubAssociation("MANNEQUIN")).toBeFalsy();
  });

  it("does not trust a missing or non-string association", () => {
    // How it actually arrives when GitHub omits the field: reading it off the
    // payload rather than passing a bare `undefined`, which the linter strips.
    const payload: PartialIssuePayload = {};
    expect(isTrustedGitHubAssociation(payload.author_association)).toBeFalsy();
    expect(isTrustedGitHubAssociation(null)).toBeFalsy();
    expect(isTrustedGitHubAssociation(1)).toBeFalsy();
  });

  it("is case sensitive, matching GitHub's payload exactly", () => {
    expect(isTrustedGitHubAssociation("owner")).toBeFalsy();
  });
});

const auth = (principalId: string): SessionAuthContext => ({
  attributes: {},
  authenticator: "github",
  principalId,
  principalType: "user",
});

describe(isAutonomous, () => {
  it("recognizes the unattended triage principal", () => {
    expect(isAutonomous(auth(AUTONOMOUS_GITHUB_PRINCIPAL))).toBeTruthy();
  });

  it("does not mistake a real GitHub actor for one", () => {
    // Projected actors always carry a numeric id, so the constructed
    // login-shaped principal cannot collide with a real account.
    expect(isAutonomous(auth("github:12345"))).toBeFalsy();
  });

  it("treats an unauthenticated session as not autonomous", () => {
    const session: PartialSession = {};
    expect(isAutonomous(session.auth ?? null)).toBeFalsy();
  });
});

describe(isScheduleAppAuth, () => {
  const appAuth: SessionAuthContext = {
    attributes: {},
    authenticator: "app",
    principalId: "eve:app",
    principalType: "runtime",
  };

  it("recognizes the app principal eve stamps on a scheduled turn", () => {
    expect(isScheduleAppAuth(appAuth)).toBeTruthy();
  });

  it("does not mistake a person or the triage principal for one", () => {
    expect(isScheduleAppAuth(auth("github:12345"))).toBeFalsy();
    expect(isScheduleAppAuth(auth(AUTONOMOUS_GITHUB_PRINCIPAL))).toBeFalsy();
  });

  it("needs all three fields, not just the principal id", () => {
    // A channel could project a user principal named eve:app; the
    // authenticator and principal type are what make it the runtime's own.
    expect(
      isScheduleAppAuth({ ...appAuth, authenticator: "github-webhook" })
    ).toBeFalsy();
    expect(
      isScheduleAppAuth({ ...appAuth, principalType: "user" })
    ).toBeFalsy();
  });
});
