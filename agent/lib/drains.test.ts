import type { DrainContext } from "evlog";
import { describe, expect, it, vi } from "vitest";

import type { DrainDestination } from "#lib/drains";
import { createFanOutDrain } from "#lib/drains";

/** The smallest wide event the drain contract accepts. */
const event = (path: string): DrainContext => ({
  event: {
    environment: "test",
    level: "info",
    path,
    service: "baymi",
    timestamp: "2026-08-21T00:00:00.000Z",
  },
});

describe(createFanOutDrain, () => {
  it("has no drain to install when nothing is configured", () => {
    expect(createFanOutDrain([])).toBeUndefined();
  });

  it("sends the event to every destination, as a batch of one", async () => {
    const first = vi.fn<DrainDestination>();
    const second = vi.fn<DrainDestination>();
    const drain = createFanOutDrain([first, second]);
    await drain?.(event("/sessions/s/turns/0"));
    expect(first).toHaveBeenCalledWith([event("/sessions/s/turns/0")]);
    expect(second).toHaveBeenCalledOnce();
  });

  it("keeps a failing destination from taking the others down", async () => {
    // Or from taking the turn down: an agent that stops answering because a
    // log shipper is unreachable has traded the product for its telemetry.
    const failing = vi
      .fn<DrainDestination>()
      .mockRejectedValue(new Error("posthog is down"));
    const healthy = vi.fn<DrainDestination>();
    const drain = createFanOutDrain([failing, healthy]);
    vi.spyOn(console, "error").mockReturnValue();
    await expect(
      drain?.(event("/sessions/s/turns/0"))
    ).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
