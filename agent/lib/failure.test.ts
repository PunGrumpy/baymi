import { describe, expect, it } from "vitest";

import {
  failureDetail,
  failureLine,
  failureNotice,
  flattenInline,
} from "#lib/failure";

describe(flattenInline, () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(flattenInline("  a \n  b\tc ", 10)).toBe("a b c");
    expect(flattenInline("abcdefghijklmnop", 8)).toBe("abcdefg…");
  });
});

describe(failureNotice, () => {
  it("includes the guidance and the code, never the provider's message", () => {
    const notice = failureNotice("I hit an error", "Mention me to retry.", {
      code: "E42",
      message: "upstream said: <the diff somebody else wrote>",
    });
    expect(notice).toContain("I hit an error.");
    expect(notice).toContain("Mention me to retry.");
    expect(notice).toContain("`E42`");
    expect(notice).not.toContain("the diff");
  });

  it("omits the code line when there is no code", () => {
    expect(failureNotice("Lead", "Guidance", {})).toBe("Lead.\n\nGuidance");
  });
});

describe(failureLine, () => {
  it("is one sentence with the code in brackets", () => {
    expect(failureLine("It broke", "Try again.", { code: "E1" })).toBe(
      "It broke [E1]. Try again."
    );
  });
});

describe(failureDetail, () => {
  it("keeps the message for the log, on one line", () => {
    expect(
      failureDetail("turn", { code: "E1", message: "line one\nline two" })
    ).toBe("[baymi] turn failed code=E1 line one line two");
  });
});
