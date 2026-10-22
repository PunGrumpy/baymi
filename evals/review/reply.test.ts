import { describe, expect, it } from "vitest";

import { hasParsedFinding } from "./reply";

const BLOCK = [
  "Security review: 1 finding",
  "",
  "### High · Query built from req.query.org",
  "File: `src/routes/export.ts:6`",
  "",
  "An attacker sets `org` to a quote and reads every row.",
].join("\n");

const BULLETS = [
  "Security review: 1 finding",
  "",
  "- High, SQL injection (`src/routes/export.ts:6`): the query is built from req.query.org.",
].join("\n");

describe(hasParsedFinding, () => {
  it("accepts the block the channel turns into an inline comment", () => {
    expect(
      hasParsedFinding(BLOCK, "src/routes/export.ts", ["high"])
    ).toBeTruthy();
  });

  it("rejects bullets, which the channel posts with no inline comment", () => {
    expect(
      hasParsedFinding(BULLETS, "src/routes/export.ts", ["high"])
    ).toBeFalsy();
  });

  it("rejects a turn that produced no reply", () => {
    expect(
      hasParsedFinding(undefined, "src/routes/export.ts", ["high"])
    ).toBeFalsy();
  });

  it("rejects a reply that does not open as a review", () => {
    expect(
      hasParsedFinding(
        BLOCK.replace("Security review:", "Review:"),
        "src/routes/export.ts",
        ["high"]
      )
    ).toBeFalsy();
  });

  it("rejects a finding on another file or at another severity", () => {
    expect(
      hasParsedFinding(BLOCK, "src/routes/admin.ts", ["high"])
    ).toBeFalsy();
    expect(
      hasParsedFinding(BLOCK, "src/routes/export.ts", ["low"])
    ).toBeFalsy();
  });

  it("rejects a finding with no line, which cannot be placed", () => {
    expect(
      hasParsedFinding(
        BLOCK.replace("src/routes/export.ts:6", "src/routes/export.ts"),
        "src/routes/export.ts",
        ["high"]
      )
    ).toBeFalsy();
  });
});
