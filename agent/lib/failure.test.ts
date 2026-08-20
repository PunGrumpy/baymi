import { describe, expect, it } from "vitest";

import { failureLine, failureNotice, flattenInline } from "#lib/failure";

describe(flattenInline, () => {
  it("collapses whitespace so a stack trace becomes one line", () => {
    expect(flattenInline("one\n  two\t\tthree")).toBe("one two three");
  });

  it("truncates past the limit and marks it", () => {
    const flattened = flattenInline("x".repeat(200));
    expect(flattened).toHaveLength(160);
    expect(flattened.endsWith("…")).toBeTruthy();
  });
});

describe(failureNotice, () => {
  it("leads with what happened and closes with how to retry", () => {
    const notice = failureNotice("I hit an error", "Mention me to retry.", {
      code: "provider_error",
      message: "fetch failed",
    });
    expect(notice).toContain("I hit an error (fetch failed).");
    expect(notice).toContain("Mention me to retry.");
    expect(notice).toContain("provider_error");
  });

  it("omits the code line when the event carries none", () => {
    const notice = failureNotice("I hit an error", "Retry.", {});
    expect(notice).toBe("I hit an error.\n\nRetry.");
  });
});

describe(failureLine, () => {
  it("stays on one line for a chat surface", () => {
    const line = failureLine("Something broke", "Try again.", {
      code: "timeout",
      message: "took too long",
    });
    expect(line).toBe("Something broke (took too long) [timeout]. Try again.");
    expect(line).not.toContain("\n");
  });
});
