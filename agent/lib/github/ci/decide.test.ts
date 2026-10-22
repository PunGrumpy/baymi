import { describe, expect, it } from "vitest";

import { decideRerun, decideSpeak } from "#lib/github/ci/decide";

describe(decideRerun, () => {
  it("reruns a flake on its first attempt", () => {
    expect(
      decideRerun({
        attempt: 1,
        classification: { kind: "flake" },
        conclusion: "failure",
      })
    ).toStrictEqual({ rerun: true });
    expect(
      decideRerun({
        attempt: 1,
        classification: { kind: "flake" },
        conclusion: "timed_out",
      })
    ).toStrictEqual({ rerun: true });
  });

  it("never reruns a flake on attempt 2: a second failure was not a flake", () => {
    expect(
      decideRerun({
        attempt: 2,
        classification: { kind: "flake" },
        conclusion: "failure",
      })
    ).toStrictEqual({ reason: "already-rerun", rerun: false });
  });

  it("never reruns the diff's own code, a stale base, or what it could not classify", () => {
    for (const kind of [
      "own-code",
      "stale-base",
      "unknown",
      "external",
    ] as const) {
      expect(
        decideRerun({
          attempt: 1,
          classification: { kind },
          conclusion: "failure",
        })
      ).toStrictEqual({ reason: "not-a-flake", rerun: false });
    }
  });

  it("does not ask for a rerun GitHub's guard will refuse: a cancelled run", () => {
    expect(
      decideRerun({
        attempt: 1,
        classification: { kind: "flake" },
        conclusion: "cancelled",
      })
    ).toStrictEqual({ reason: "not-rerunnable", rerun: false });
  });
});

const RERUN = { rerun: true } as const;
const NO_RERUN = { reason: "not-a-flake", rerun: false } as const;

describe(decideSpeak, () => {
  it("is silent when a flake was rerun: the digest carries the result", () => {
    expect(
      decideSpeak({
        attempt: 1,
        classification: { kind: "flake" },
        rerun: RERUN,
        rerunTriggered: true,
      })
    ).toBeNull();
  });

  it("speaks when a flake that should have been rerun was not", () => {
    expect(
      decideSpeak({
        attempt: 1,
        classification: { kind: "flake" },
        rerun: RERUN,
        rerunTriggered: false,
      })
    ).toBe("rerun-not-done");
  });

  it("speaks on a second failure after a rerun, whatever its class", () => {
    expect(
      decideSpeak({
        attempt: 2,
        classification: { kind: "flake" },
        rerun: { reason: "already-rerun", rerun: false },
        rerunTriggered: false,
      })
    ).toBe("second-failure");
  });

  it("speaks when a flake cannot be rerun at all", () => {
    expect(
      decideSpeak({
        attempt: 1,
        classification: { kind: "flake" },
        rerun: { reason: "not-rerunnable", rerun: false },
        rerunTriggered: false,
      })
    ).toBe("cannot-rerun");
  });

  it.each([
    ["external", "external-check"],
    ["own-code", "own-code"],
    ["stale-base", "stale-base"],
    ["unknown", "unclassified"],
  ] as const)(
    "speaks for %s, which blocks the pull request on a person",
    (kind, reason) => {
      expect(
        decideSpeak({
          attempt: 1,
          classification: { kind },
          rerun: NO_RERUN,
          rerunTriggered: false,
        })
      ).toBe(reason);
    }
  );
});
