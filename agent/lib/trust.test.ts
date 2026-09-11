import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  isSlackHuman,
  isTrustedGitHubAssociation,
  isUnattended,
  REVIEWER_PRINCIPAL,
} from "#lib/trust";

const auth = (overrides: Partial<SessionAuthContext>): SessionAuthContext => ({
  attributes: {},
  authenticator: "slack-webhook",
  principalId: "slack:T0AAAAAAA:U0BBBBBBB",
  principalType: "user",
  ...overrides,
});

describe(isTrustedGitHubAssociation, () => {
  it("trusts the roles with write access to the repository", () => {
    for (const role of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(isTrustedGitHubAssociation(role)).toBeTruthy();
    }
  });

  it("does not trust contributors, first-timers, or anyone else", () => {
    for (const role of [
      "CONTRIBUTOR",
      "FIRST_TIME_CONTRIBUTOR",
      "FIRST_TIMER",
      "NONE",
      "MANNEQUIN",
    ]) {
      expect(isTrustedGitHubAssociation(role)).toBeFalsy();
    }
  });

  it("treats a missing or malformed value as untrusted", () => {
    // `raw` is untyped JSON, so the field can be absent or anything at all.
    expect(isTrustedGitHubAssociation()).toBeFalsy();
    expect(isTrustedGitHubAssociation(null)).toBeFalsy();
    expect(isTrustedGitHubAssociation("owner")).toBeFalsy();
    expect(isTrustedGitHubAssociation(1)).toBeFalsy();
  });
});

describe(isUnattended, () => {
  it("recognizes the reviewer principal and nothing else", () => {
    expect(
      isUnattended(
        auth({
          authenticator: "github-webhook",
          principalId: REVIEWER_PRINCIPAL,
          principalType: "service",
        })
      )
    ).toBeTruthy();
    expect(
      isUnattended(
        auth({ authenticator: "github-webhook", principalId: "github:42" })
      )
    ).toBeFalsy();
    expect(isUnattended(null)).toBeFalsy();
  });
});

describe(isSlackHuman, () => {
  it("admits a person delivered by the Slack channel", () => {
    expect(isSlackHuman(auth({}))).toBeTruthy();
  });

  it("keeps bots out, including other apps in the workspace", () => {
    expect(
      isSlackHuman(
        auth({
          principalId: "slack:T0AAAAAAA:bot:B0CCCCCCC",
          principalType: "service",
        })
      )
    ).toBeFalsy();
  });

  it("pins the workspace when a team id is configured", () => {
    // A Slack Connect guest arrives as a human of another team; the pin is
    // what keeps them out.
    expect(isSlackHuman(auth({}), "T0AAAAAAA")).toBeTruthy();
    expect(isSlackHuman(auth({}), "T0ZZZZZZZ")).toBeFalsy();
  });

  it("never admits a principal from another channel", () => {
    expect(
      isSlackHuman(
        auth({ authenticator: "github-webhook", principalId: "github:42" })
      )
    ).toBeFalsy();
  });
});
