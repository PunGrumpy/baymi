import { describe, expect, it, vi } from "vitest";

import type { GitHubRequest } from "#lib/github/checks";
import { COMMENT_MAX_LENGTH } from "#lib/github/review";
import {
  findSummaryComment,
  renderSummary,
  summaryMarker,
  upsertSummary,
} from "#lib/github/summary";

const SHA = "abc1234def5678";

const comment = (id: number, login: string, body: string) => ({
  body,
  id,
  user: { login },
});

const target = {
  botName: "baymiai",
  owner: "acme",
  pullRequestNumber: 7,
  repo: "widgets",
};

describe(renderSummary, () => {
  it("ends with the short head and the marker", () => {
    expect(renderSummary("Security review: nothing to raise.", SHA)).toBe(
      `Security review: nothing to raise.\n\n_Reviewed at \`abc1234\`._\n\n${summaryMarker(SHA)}`
    );
  });

  it("leaves the head out when there is none", () => {
    expect(renderSummary("Security review: nothing to raise.", null)).toBe(
      "Security review: nothing to raise.\n\n<!-- baymi:summary -->"
    );
  });

  it("stays inside GitHub's comment limit and keeps the marker", () => {
    const rendered = renderSummary("x".repeat(COMMENT_MAX_LENGTH * 2), SHA);
    expect(rendered.length).toBeLessThanOrEqual(COMMENT_MAX_LENGTH);
    expect(rendered.endsWith(summaryMarker(SHA))).toBeTruthy();
  });
});

describe(findSummaryComment, () => {
  it("finds the bot's comment by its marker", () => {
    expect(
      findSummaryComment(
        [
          comment(1, "vercel[bot]", "Deployed"),
          comment(
            2,
            "baymiai[bot]",
            `Security review: …\n\n${summaryMarker(SHA)}`
          ),
        ],
        "baymiai"
      )
    ).toBe(2);
  });

  it("ignores the marker in a comment someone else wrote", () => {
    expect(
      findSummaryComment(
        [comment(3, "mallory", `quoting it: ${summaryMarker(SHA)}`)],
        "baymiai"
      )
    ).toBeNull();
  });

  it("ignores the bot's other comments", () => {
    expect(
      findSummaryComment(
        [comment(4, "baymiai[bot]", "Fixed, thanks.")],
        "baymiai"
      )
    ).toBeNull();
  });

  it("takes the latest when there are several", () => {
    expect(
      findSummaryComment(
        [
          comment(5, "baymiai[bot]", summaryMarker(null)),
          comment(6, "baymiai[bot]", summaryMarker(SHA)),
        ],
        "baymiai"
      )
    ).toBe(6);
  });
});

describe(upsertSummary, () => {
  it("posts the summary when the pull request has none", async () => {
    const request = vi.fn<GitHubRequest>((input) =>
      Promise.resolve(input.method === "GET" ? { body: [] } : { body: {} })
    );
    await expect(
      upsertSummary({ ...target, body: "summary", request })
    ).resolves.toStrictEqual({ ok: true });
    expect(request).toHaveBeenLastCalledWith({
      body: { body: "summary" },
      method: "POST",
      path: "/repos/acme/widgets/issues/7/comments",
    });
  });

  it("edits the summary that is already there", async () => {
    const request = vi.fn<GitHubRequest>((input) =>
      Promise.resolve(
        input.method === "GET"
          ? { body: [comment(42, "baymiai[bot]", summaryMarker(SHA))] }
          : { body: {} }
      )
    );
    await upsertSummary({ ...target, body: "new summary", request });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      body: { body: "new summary" },
      method: "PATCH",
      path: "/repos/acme/widgets/issues/comments/42",
    });
  });

  it("reads past a full page of comments", async () => {
    const filler = Array.from({ length: 100 }, (_, index) =>
      comment(index, "someone", "lgtm")
    );
    const pageOf = (path: string) => {
      if (path.endsWith("page=1")) {
        return filler;
      }
      if (path.endsWith("page=2")) {
        return [comment(900, "baymiai[bot]", summaryMarker(SHA))];
      }
      return [];
    };
    const request = vi.fn<GitHubRequest>((input) =>
      Promise.resolve({ body: pageOf(input.path) })
    );
    await upsertSummary({ ...target, body: "new summary", request });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/repos/acme/widgets/issues/comments/900",
      })
    );
  });

  it("answers an error instead of throwing", async () => {
    const request = vi.fn<GitHubRequest>().mockRejectedValue(new Error("403"));
    const result = await upsertSummary({ ...target, body: "summary", request });
    expect(result.ok).toBeFalsy();
  });
});
