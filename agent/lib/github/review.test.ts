import { describe, expect, it } from "vitest";

import {
  findingId,
  findingMarker,
  parseReview,
  renderReview,
  reviewMarker,
  splitComment,
} from "#lib/github/review";

const REVIEW = `Security review: 2 findings (1 high, 1 low).

Checked and clean: the \`listUsers\` change only adds a column to the select.

### High · any caller can change any user's role
File: src/routes/admin.ts:12

<details>
<summary>Why the code allows it, and what closes it</summary>

The route has no middleware. Its sibling on line 10 is behind \`requireAdmin\`.

</details>

\`\`\`suggestion
router.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
\`\`\`

### Low: the error handler returns the stack to the client
File: \`src/server.ts:88\`
Return a generic message and log the stack instead.`;

describe(parseReview, () => {
  it("answers null for a reply that is not a review", () => {
    expect(parseReview("Thanks, that looks right to me.")).toBeNull();
  });

  it("splits the body from the findings", () => {
    const review = parseReview(REVIEW);
    expect(review?.body).toBe(
      "Security review: 2 findings (1 high, 1 low).\n\nChecked and clean: the `listUsers` change only adds a column to the select."
    );
    expect(review?.findings).toHaveLength(2);
  });

  it("places each finding on its line and keeps the location out of the body", () => {
    const [high, low] = parseReview(REVIEW)?.findings ?? [];
    expect(high).toMatchObject({
      line: 12,
      path: "src/routes/admin.ts",
      severity: "high",
      title: "any caller can change any user's role",
    });
    expect(high?.body).toContain("```suggestion");
    expect(high?.body).not.toContain("File:");
    expect(low).toMatchObject({
      body: "Return a generic message and log the stack instead.",
      line: 88,
      path: "src/server.ts",
      severity: "low",
    });
  });

  it("folds a finding it cannot place back into the body", () => {
    const review = parseReview(
      "Security review: 1 finding (1 medium).\n\n### Medium · CORS opened to a wildcard\nThe middleware now reflects any origin."
    );
    expect(review?.findings).toHaveLength(0);
    expect(review?.body).toContain("### Medium · CORS opened to a wildcard");
    expect(review?.body).toContain("The middleware now reflects any origin.");
  });

  it("parses a clean review as a body with no findings", () => {
    const review = parseReview(
      "Security review: nothing to raise.\n\nThe change adds a read-only endpoint."
    );
    expect(review?.findings).toStrictEqual([]);
    expect(review?.body).toContain("nothing to raise");
  });
});

describe(findingId, () => {
  it("is stable for the same place and title, and short", () => {
    const finding = { line: 12, path: "src/a.ts", title: "x" };
    expect(findingId(finding)).toBe(findingId({ ...finding }));
    expect(findingId(finding)).toHaveLength(8);
    expect(findingId({ ...finding, line: 13 })).not.toBe(findingId(finding));
  });
});

describe(renderReview, () => {
  it("leads each comment with the severity and ends everything with a marker", () => {
    const review = parseReview(REVIEW);
    if (review === null) {
      throw new Error("fixture did not parse");
    }
    const rendered = renderReview(review, "72eadbc");
    expect(rendered.body.endsWith(reviewMarker(2, "72eadbc"))).toBeTruthy();
    expect(rendered.body).toContain("findings=2 sha=72eadbc");
    const [high] = rendered.comments;
    const [first] = review.findings;
    if (first === undefined) {
      throw new Error("fixture has no finding");
    }
    expect(high?.body.startsWith("**High** · any caller")).toBeTruthy();
    expect(high?.body.endsWith(findingMarker(first, "72eadbc"))).toBeTruthy();
    expect(high).toMatchObject({
      line: 12,
      path: "src/routes/admin.ts",
      side: "RIGHT",
    });
  });

  it("omits the sha when the checkout did not record one", () => {
    expect(reviewMarker(0, null)).toBe("<!-- baymi:review findings=0 -->");
  });
});

describe(splitComment, () => {
  it("keeps a normal reply whole", () => {
    expect(splitComment("one\n\ntwo")).toStrictEqual(["one\n\ntwo"]);
  });

  it("splits on paragraph boundaries when a reply runs long", () => {
    const paragraph = "x".repeat(40);
    const chunks = splitComment(
      `${paragraph}\n\n${paragraph}\n\n${paragraph}`,
      90
    );
    expect(chunks).toStrictEqual([`${paragraph}\n\n${paragraph}`, paragraph]);
  });
});
