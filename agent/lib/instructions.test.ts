import { describe, expect, it } from "vitest";

import { channelName, loadsOnChannel } from "#lib/instructions";

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
