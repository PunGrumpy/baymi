import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import {
  channelName,
  loadsLeadOrders,
  loadsOnChannel,
} from "#lib/instructions";
import { isUnattended, REVIEWER_PRINCIPAL } from "#lib/trust";

const auth = (overrides: Partial<SessionAuthContext>): SessionAuthContext => ({
  attributes: {},
  authenticator: "slack-webhook",
  principalId: "slack:T0AAAAAAA:U0BBBBBBB",
  principalType: "user",
  ...overrides,
});

describe(channelName, () => {
  it("strips the prefix an authored channel reports", () => {
    expect(channelName("channel:github")).toBe("github");
    expect(channelName("slack")).toBe("slack");
  });

  it("names an unknown channel rather than throwing", () => {
    expect(channelName()).toBe("unknown");
  });
});

describe(loadsOnChannel, () => {
  it("loads a fragment on its own channel, prefixed or bare", () => {
    expect(loadsOnChannel("github", "github")).toBeTruthy();
    expect(loadsOnChannel("github", "channel:github")).toBeTruthy();
  });

  it("withholds a fragment from another product channel", () => {
    expect(loadsOnChannel("slack", "channel:github")).toBeFalsy();
    expect(loadsOnChannel("github", "slack")).toBeFalsy();
  });

  it("loads every fragment on a route that is not a product channel", () => {
    // `eve dev` and the eval runner drive the HTTP route to exercise behavior
    // that belongs to another channel.
    expect(loadsOnChannel("github", "http")).toBeTruthy();
    expect(loadsOnChannel("slack")).toBeTruthy();
  });
});

describe(loadsLeadOrders, () => {
  it("withholds the lead's orders from the security review", () => {
    const reviewer = auth({
      authenticator: "github-webhook",
      principalId: REVIEWER_PRINCIPAL,
      principalType: "service",
    });
    expect(loadsLeadOrders(reviewer)).toBeFalsy();
  });

  it("loads them on the app's own scheduled turn, which is unattended too", () => {
    const schedule = auth({
      authenticator: "app",
      principalId: "eve:app",
      principalType: "runtime",
    });
    expect(isUnattended(schedule)).toBeTruthy();
    expect(loadsLeadOrders(schedule)).toBeTruthy();
  });

  it("loads them for a person on Slack or GitHub", () => {
    expect(loadsLeadOrders(auth({}))).toBeTruthy();
    expect(
      loadsLeadOrders(
        auth({ authenticator: "github-webhook", principalId: "github:1234" })
      )
    ).toBeTruthy();
  });

  it("loads them when the turn has no caller, as on a direct API route", () => {
    expect(loadsLeadOrders(null)).toBeTruthy();
  });
});
