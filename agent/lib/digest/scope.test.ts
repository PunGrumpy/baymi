import { describe, expect, it } from "vitest";

import {
  bangkokDate,
  bangkokDayStart,
  digestQuery,
  ownersOf,
  windowStart,
} from "#lib/digest/scope";

/** 08:00 in Bangkok, the minute the digest fires. */
const MORNING = new Date("2026-10-23T01:00:00.000Z");

describe(bangkokDate, () => {
  it("is the date in Bangkok, which is seven hours ahead of UTC", () => {
    expect(bangkokDate(MORNING)).toBe("2026-10-23");
  });

  it("rolls to the next day at 17:00 UTC, when Bangkok passes midnight", () => {
    expect(bangkokDate(new Date("2026-10-22T16:59:59.000Z"))).toBe(
      "2026-10-22"
    );
    expect(bangkokDate(new Date("2026-10-22T17:00:00.000Z"))).toBe(
      "2026-10-23"
    );
  });
});

describe(bangkokDayStart, () => {
  it("is midnight in Bangkok as Unix seconds", () => {
    // 2026-10-23 00:00 +07:00 is 2026-10-22 17:00 UTC.
    expect(bangkokDayStart(MORNING)).toBe(
      Date.parse("2026-10-22T17:00:00.000Z") / 1000
    );
  });

  it("is the same instant for every moment of one Bangkok day", () => {
    expect(bangkokDayStart(new Date("2026-10-22T17:00:00.000Z"))).toBe(
      bangkokDayStart(new Date("2026-10-23T16:59:00.000Z"))
    );
  });
});

describe(windowStart, () => {
  it("is thirty days before today in Bangkok", () => {
    expect(windowStart(MORNING)).toBe("2026-09-23");
  });

  it("counts across a month boundary", () => {
    expect(windowStart(new Date("2026-03-05T01:00:00.000Z"))).toBe(
      "2026-02-03"
    );
  });
});

describe(digestQuery, () => {
  it("scopes to the owner's open, non-draft pull requests updated in the window", () => {
    expect(digestQuery({ now: MORNING, owners: ["PunGrumpy"] })).toBe(
      "user:PunGrumpy is:pr is:open draft:false archived:false updated:>=2026-09-23"
    );
  });

  it("names every owner", () => {
    expect(digestQuery({ now: MORNING, owners: ["a", "b"] })).toBe(
      "user:a user:b is:pr is:open draft:false archived:false updated:>=2026-09-23"
    );
  });

  it("moves with the date it is asked on", () => {
    expect(
      digestQuery({
        now: new Date("2026-11-02T01:00:00.000Z"),
        owners: ["PunGrumpy"],
      })
    ).toContain("updated:>=2026-10-03");
  });
});

describe(ownersOf, () => {
  it("lists each owner once, in first-seen order", () => {
    expect(
      ownersOf(["PunGrumpy/baymi", "PunGrumpy/nipa", "acme/widgets"])
    ).toStrictEqual(["PunGrumpy", "acme"]);
  });

  it("is empty for no repositories", () => {
    expect(ownersOf([])).toStrictEqual([]);
  });
});
