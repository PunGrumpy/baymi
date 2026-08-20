import { describe, expect, it } from "vitest";

import { exposesSlackDmTool } from "#lib/slack";

/** A channel whose optional `kind` the runtime has not set. */
interface PartialChannel {
  readonly kind?: string;
}

describe(exposesSlackDmTool, () => {
  it("withholds the tool from a Slack session, which posts the reply itself", () => {
    expect(exposesSlackDmTool("slack")).toBeFalsy();
  });

  it("offers it on the surfaces that have no Slack thread to reply into", () => {
    expect(exposesSlackDmTool("linear")).toBeTruthy();
    expect(exposesSlackDmTool("github")).toBeTruthy();
    expect(exposesSlackDmTool("http")).toBeTruthy();
  });

  it("offers it when the channel kind is unknown", () => {
    const channelWithoutKind: PartialChannel = {};
    expect(exposesSlackDmTool(channelWithoutKind.kind)).toBeTruthy();
  });
});
