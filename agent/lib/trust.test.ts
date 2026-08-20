import { describe, expect, it } from "vitest";

import { isTrustedGitHubAssociation } from "#lib/trust";

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
