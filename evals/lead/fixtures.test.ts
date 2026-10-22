import { describe, expect, it } from "vitest";

import {
  HEALTHY,
  WAITING,
  digestTurn,
  namedPullRequests,
  namesAPullRequest,
  pullRequestLinks,
} from "./fixtures";

describe(digestTurn, () => {
  it("lists every healthy pull request and says none need the owner", () => {
    const turn = digestTurn([], HEALTHY);
    expect(turn).toContain("Needs PunGrumpy: none");
    expect(turn).toContain(`Healthy (${HEALTHY.length}):`);
    for (const { url } of HEALTHY) {
      expect(turn).toContain(url);
    }
  });

  it("lists the waiting pull request under the owner's heading", () => {
    const turn = digestTurn([WAITING], HEALTHY);
    expect(turn).toContain(`Needs PunGrumpy: \n- ${WAITING.url}`);
  });
});

describe(pullRequestLinks, () => {
  it("returns links in order of appearance", () => {
    expect(
      pullRequestLinks(`first ${WAITING.url} then ${HEALTHY[0]?.url}`)
    ).toStrictEqual([WAITING.url, HEALTHY[0]?.url]);
  });

  it("returns an empty list when the reply links nothing", () => {
    expect(pullRequestLinks("ไม่มีอะไรต้องดูเช้านี้")).toStrictEqual([]);
  });
});

describe(namesAPullRequest, () => {
  it("catches a link and a bare number", () => {
    expect(namesAPullRequest(`see ${WAITING.url}`)).toBeTruthy();
    expect(namesAPullRequest("PR #41 is fine")).toBeTruthy();
  });

  it("passes a reply that only counts", () => {
    expect(namesAPullRequest("ไม่มีอะไรต้องดูเช้านี้ ทั้ง 4 รายการปกติดี")).toBeFalsy();
  });
});

describe(namedPullRequests, () => {
  it("returns the number from a link, a path and a hash", () => {
    expect(
      namedPullRequests(`${WAITING.url}, web/pull/41 and example-owner/docs#12`)
    ).toStrictEqual(["88", "41", "12"]);
  });
});
