import { describe, expect, it } from "vitest";

import {
  budgetLeftMs,
  claimChase,
  createMemoryBudgetStore,
  DAILY_CHASES,
  decideClaim,
  headKey,
  SANDBOX_BUDGET_MS,
  utcDay,
} from "#lib/chase/budget";
import type { BudgetStore } from "#lib/chase/budget";

const NOON = Date.parse("2026-10-23T12:00:00Z");
const NEXT_DAY = Date.parse("2026-10-24T00:00:01Z");

const head = (sha: string) => headKey("Acme/Widgets", sha);

describe(utcDay, () => {
  it("names the UTC day, not the local one", () => {
    expect(utcDay(Date.parse("2026-10-23T23:59:59Z"))).toBe("2026-10-23");
    expect(utcDay(Date.parse("2026-10-24T06:30:00+07:00"))).toBe("2026-10-23");
  });
});

describe(claimChase, () => {
  it("allows the default number of chases a day, then refuses until the next", async () => {
    const store = createMemoryBudgetStore();
    const claims = await Promise.all(
      ["a", "b", "c", "d"].map((sha) =>
        claimChase(store, { head: head(sha), now: NOON })
      )
    );
    expect(DAILY_CHASES).toBe(3);
    expect(claims).toStrictEqual([
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: false, reason: "daily-cap" },
    ]);
    await expect(
      claimChase(store, { head: head("d"), now: NEXT_DAY })
    ).resolves.toStrictEqual({ ok: true });
  });

  it("chases one head once, even on another day", async () => {
    const store = createMemoryBudgetStore();
    await expect(
      claimChase(store, { head: head("a"), now: NOON })
    ).resolves.toStrictEqual({ ok: true });
    await expect(
      claimChase(store, { head: head("a"), now: NOON })
    ).resolves.toStrictEqual({ ok: false, reason: "head-chased" });
    await expect(
      claimChase(store, { head: headKey("acme/widgets", "a"), now: NOON })
    ).resolves.toStrictEqual({ ok: false, reason: "head-chased" });
  });

  it("takes a lower cap when one is given", async () => {
    const store = createMemoryBudgetStore();
    await claimChase(store, { cap: 1, head: head("a"), now: NOON });
    await expect(
      claimChase(store, { cap: 1, head: head("b"), now: NOON })
    ).resolves.toStrictEqual({ ok: false, reason: "daily-cap" });
  });

  it("refuses when the store cannot be read or written", async () => {
    const broken: BudgetStore = {
      claim: () => Promise.reject(new Error("blob store unreachable")),
    };
    await expect(
      claimChase(broken, { head: head("a"), now: NOON })
    ).resolves.toStrictEqual({ ok: false, reason: "store-unreadable" });
  });
});

describe(decideClaim, () => {
  it("leaves the ledger as it was on a refusal", () => {
    const ledger = { day: "2026-10-23", heads: ["x", "y", "z"] };
    expect(
      decideClaim(ledger, { cap: 3, day: "2026-10-23", head: "w" })
    ).toStrictEqual({ ledger, verdict: "daily-cap" });
  });

  it("starts a new day from an empty ledger", () => {
    expect(
      decideClaim(
        { day: "2026-10-22", heads: ["x", "y", "z"] },
        { cap: 3, day: "2026-10-23", head: "x" }
      )
    ).toStrictEqual({
      ledger: { day: "2026-10-23", heads: ["x"] },
      verdict: "claimed",
    });
  });
});

describe(budgetLeftMs, () => {
  it("counts down twenty-five sandbox minutes from the checkout", () => {
    expect(SANDBOX_BUDGET_MS).toBe(25 * 60 * 1000);
    expect(budgetLeftMs(NOON, NOON + 60_000)).toBe(24 * 60 * 1000);
    expect(budgetLeftMs(NOON, NOON + SANDBOX_BUDGET_MS + 1)).toBeLessThan(0);
  });
});
