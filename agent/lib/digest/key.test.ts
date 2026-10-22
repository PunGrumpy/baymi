import { describe, expect, it } from "vitest";

import type { Classified, FailureClass, Verdict } from "#lib/digest/classify";
import { digestKey } from "#lib/digest/key";

const entry = (
  number: number,
  verdict: Verdict,
  repository = "PunGrumpy/baymi"
): Classified => ({
  author: null,
  baseRef: "main",
  number,
  repository,
  verdict,
});

const ready = (number: number) =>
  entry(number, { bucket: "needs-owner", reason: { kind: "ready" } });
const ci = (number: number, checks: string[], failure: FailureClass = "diff") =>
  entry(number, {
    bucket: "blocked",
    reason: { behind: false, checks, failure, kind: "ci" },
  });

const DATE = "2026-10-23";

describe(digestKey, () => {
  it("is the Bangkok date and a short hash", () => {
    expect(digestKey(DATE, [ready(1)])).toMatch(/^2026-10-23:[0-9a-f]{12}$/u);
  });

  it("is the same key for the same classified set, however it is ordered", () => {
    expect(digestKey(DATE, [ready(1), ready(2)])).toBe(
      digestKey(DATE, [ready(2), ready(1)])
    );
  });

  it("changes when a pull request moves to another bucket", () => {
    expect(digestKey(DATE, [ready(1)])).not.toBe(
      digestKey(DATE, [ci(1, ["Test"])])
    );
  });

  it("changes when the reason within a bucket changes", () => {
    expect(digestKey(DATE, [ci(1, ["Test"], "diff")])).not.toBe(
      digestKey(DATE, [ci(1, ["Test"], "stale-base")])
    );
  });

  it("changes when a pull request joins or leaves the set", () => {
    expect(digestKey(DATE, [ready(1)])).not.toBe(
      digestKey(DATE, [ready(1), ready(2)])
    );
  });

  it("changes with the day", () => {
    expect(digestKey("2026-10-23", [ready(1)])).not.toBe(
      digestKey("2026-10-26", [ready(1)])
    );
  });

  it("does not change with the names of the failing checks", () => {
    expect(digestKey(DATE, [ci(1, ["Test"])])).toBe(
      digestKey(DATE, [ci(1, ["Lint", "Test"])])
    );
  });

  it("tells repositories apart", () => {
    expect(digestKey(DATE, [entry(1, ready(1).verdict)])).not.toBe(
      digestKey(DATE, [entry(1, ready(1).verdict, "PunGrumpy/other")])
    );
  });

  it("has a key for an empty day", () => {
    expect(digestKey(DATE, [])).toMatch(/^2026-10-23:[0-9a-f]{12}$/u);
  });
});
