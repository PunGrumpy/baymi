import { describe, expect, it } from "vitest";

import {
  anchorReview,
  linesOfPatch,
  placeLine,
  unplacedFinding,
} from "#lib/github/anchors";
import { parseReview } from "#lib/github/review";

const PATCH = [
  "@@ -1,4 +1,6 @@",
  ' import { Message } from "chat";',
  '-import type { LineEvent } from "./types.js";',
  '+import type { LineEvent, LineLocation } from "./types.js";',
  "+",
  " export interface LineMessageData {",
  "+  location?: LineLocation;",
  "   mentions: LineMention[];",
  "@@ -20,3 +22,4 @@ export class LineMessage {",
  "   get sticker() {",
  "+    return this.data.sticker;",
  "   }",
  "\\ No newline at end of file",
].join("\n");

const FILES = [
  { filename: "src/message.ts", patch: PATCH },
  { filename: "bun.lockb", patch: null },
];

describe(linesOfPatch, () => {
  it("numbers the new side and skips removed lines", () => {
    expect(linesOfPatch(PATCH)).toStrictEqual({
      added: [2, 3, 5, 23],
      context: [1, 4, 6, 22, 24],
    });
  });
});

describe(placeLine, () => {
  const lines = linesOfPatch(PATCH);

  it("keeps a line the diff contains", () => {
    expect(placeLine(lines, 5)).toBe(5);
    expect(placeLine(lines, 22)).toBe(22);
  });

  it("puts a finding with no line on the first added line", () => {
    expect(placeLine(lines, null)).toBe(2);
  });

  it("moves a line outside the diff to the nearest added line", () => {
    expect(placeLine(lines, 9)).toBe(5);
    expect(placeLine(lines, 40)).toBe(23);
  });

  it("falls back to context lines when the file only lost lines", () => {
    const removals = linesOfPatch(
      "@@ -3,3 +3,2 @@\n const a = 1;\n-const b = 2;\n const c = 3;"
    );
    expect(placeLine(removals, null)).toBe(3);
    expect(placeLine({ added: [], context: [] }, 1)).toBeNull();
  });
});

const REVIEW = `Security review: 3 findings (1 high, 2 low).

Checked and clean: the outbound validator bounds every coordinate.

### High · a location message accepts any latitude
File: src/message.ts

The bound check on line 5 is skipped for inbound events.

### Low · the excluded lockfile
File: bun.lockb:1

Something about the lockfile.

### Low · a file the change does not touch
File: src/adapter.ts:40

Something elsewhere.`;

describe(anchorReview, () => {
  it("places what it can and folds the rest into the body", () => {
    const review = parseReview(REVIEW);
    if (review === null) {
      throw new Error("fixture did not parse");
    }
    const anchored = anchorReview(review, FILES);
    expect(anchored.findings).toHaveLength(1);
    expect(anchored.findings[0]).toMatchObject({
      line: 2,
      path: "src/message.ts",
      severity: "high",
    });
    expect(
      anchored.body.startsWith("Security review: 3 findings")
    ).toBeTruthy();
    expect(anchored.body).toContain(
      "**Low** · the excluded lockfile (`bun.lockb:1`)"
    );
    expect(anchored.body).toContain(
      "**Low** · a file the change does not touch (`src/adapter.ts:40`)\n\nSomething elsewhere."
    );
  });
});

describe(unplacedFinding, () => {
  it("names the file when the model gave no line", () => {
    expect(
      unplacedFinding({
        body: "",
        line: null,
        path: "src/a.ts",
        severity: "medium",
        title: "x",
      })
    ).toBe("**Medium** · x (`src/a.ts`)");
  });
});
