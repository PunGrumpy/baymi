import { describe, expect, it } from "vitest";

import { CHANNEL_KINDS, loadsOnChannel } from "#lib/instructions";

describe(loadsOnChannel, () => {
  it("loads a fragment on its own channel", () => {
    for (const channel of CHANNEL_KINDS) {
      expect(loadsOnChannel(channel, channel)).toBeTruthy();
    }
  });

  it("withholds a fragment from the other product surfaces", () => {
    expect(loadsOnChannel("slack", "github")).toBeFalsy();
    expect(loadsOnChannel("github", "linear")).toBeFalsy();
    expect(loadsOnChannel("linear", "slack")).toBeFalsy();
  });

  it("loads every fragment on the HTTP session surface", () => {
    for (const channel of CHANNEL_KINDS) {
      expect(loadsOnChannel(channel, "http")).toBeTruthy();
    }
  });

  it("loads every fragment when the channel kind is unknown", () => {
    // `ctx.channel.kind` is optional; read it off a channel that has none
    // rather than passing a bare `undefined`, which the linter strips.
    const channelWithoutKind: { readonly kind?: string } = {};
    for (const channel of CHANNEL_KINDS) {
      expect(loadsOnChannel(channel, channelWithoutKind.kind)).toBeTruthy();
    }
  });
});
