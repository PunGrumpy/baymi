import { describe, expect, it } from "vitest";

import {
  failureDetail,
  failureLine,
  failureNotice,
  flattenInline,
} from "#lib/failure";

/**
 * The shape of the failure that prompted all of this: a gateway rejection in a
 * language the reader does not have, quoting the request back at them.
 */
const CHINESE_REJECTION = {
  code: "provider_error",
  message: "内容审核未通过：请求包含敏感内容",
} as const;

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
    expect(notice).toContain("I hit an error.");
    expect(notice).toContain("Mention me to retry.");
    expect(notice).toContain("provider_error");
  });

  it("never repeats the provider's words to the reader", () => {
    // This notice is posted into someone else's GitHub issue. The gateway's
    // own text is unreadable there at best, and at worst it is the request
    // quoted back, which is content this project does not send anywhere.
    const notice = failureNotice("I hit an error", "Retry.", CHINESE_REJECTION);
    expect(notice).not.toContain(CHINESE_REJECTION.message);
    // The opening characters too, not just the whole string: the old code ran
    // the message through `flattenInline` first, so a leak that came back the
    // same way would be a truncated prefix and would slip past the check above.
    expect(notice).not.toContain("内容审核未通过");
    // The code still travels: opaque to the reader, everything to whoever
    // they forward it to.
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
    expect(line).toBe("Something broke [timeout]. Try again.");
    expect(line).not.toContain("\n");
  });

  it("withholds the provider's words on Slack too", () => {
    // Slack is less public than a GitHub issue, not private: a channel has
    // members, and the same rejection can quote a message somebody else wrote.
    const line = failureLine(
      "Something broke",
      "Try again.",
      CHINESE_REJECTION
    );
    expect(line).not.toContain(CHINESE_REJECTION.message);
  });
});

describe(failureDetail, () => {
  it("keeps the provider's words for the runtime log", () => {
    // The text is not discarded, only redirected: the log is the machine the
    // agent already runs on rather than a reader or a third party.
    const detail = failureDetail("turn", CHINESE_REJECTION);
    expect(detail).toContain(CHINESE_REJECTION.message);
    expect(detail).toContain("code=provider_error");
    expect(detail).toContain("turn failed");
  });

  it("gives a log line far more room than a comment gets", () => {
    // 160 characters is a length chosen for someone else's issue thread. A log
    // is read on purpose, and truncating a stack there costs the diagnosis.
    const detail = failureDetail("session", { message: "x".repeat(2000) });
    expect(detail.length).toBeGreaterThan(400);
    expect(detail.endsWith("…")).toBeTruthy();
  });

  it("says only what it has", () => {
    expect(failureDetail("turn", {})).toBe("[baymi] turn failed");
  });
});
