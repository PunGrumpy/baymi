import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  AUTONOMOUS_GITHUB_PRINCIPAL,
  isAutonomous,
  isTrustedGitHubAssociation,
} from "#lib/trust";

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
    const payload: { readonly author_association?: unknown } = {};
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
    const missing: { readonly value?: SessionAuthContext | null } = {};
    expect(isAutonomous(missing.value ?? null)).toBeFalsy();
  });
});
