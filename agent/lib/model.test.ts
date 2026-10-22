import { describe, expect, it } from "vitest";

import {
  LEAD_CONTEXT_WINDOW_TOKENS,
  LEAD_MODEL,
  LEAD_MODEL_ID,
  LEAD_MODEL_OPTIONS,
  WORKER_MODEL,
} from "#lib/model";

describe("model", () => {
  it("names a native Anthropic id for the lead, which has no slash", () => {
    // A gateway id (`anthropic/claude-opus-5.5`) would route through AI
    // Gateway, and eve's `anthropic()` refuses an id that still has a slash.
    expect(LEAD_MODEL_ID).toBe("claude-opus-5-5");
    expect(LEAD_MODEL_ID).not.toContain("/");
  });

  it("builds the lead from Anthropic directly, not through the gateway", () => {
    // `anthropic()` returns an AI SDK model object, where a gateway id would
    // be a bare string.
    expect(LEAD_MODEL).toMatchObject({
      modelId: LEAD_MODEL_ID,
      provider: expect.stringMatching(/^anthropic/u),
    });
  });

  it("states the lead's context window, which eve cannot look up for a direct model", () => {
    expect(LEAD_CONTEXT_WINDOW_TOKENS).toBe(1_000_000);
  });

  it("asks Anthropic for max effort on the lead, past eve's xhigh", () => {
    expect(LEAD_MODEL_OPTIONS.providerOptions.anthropic.effort).toBe("max");
  });

  it("keeps the worker a gateway id, because a dynamic subagent takes nothing else", () => {
    // eve 0.62.0 rejects a provider object from a dynamic subagent, so
    // `anthropic("claude-sonnet-5-5")` here would drop the remediation
    // subagent at runtime (`docs/notes.md`).
    expect(WORKER_MODEL).toBe("moonshotai/kimi-k2.7-code");
  });
});
