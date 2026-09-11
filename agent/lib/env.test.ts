import { afterEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  ANTHROPIC_API_KEY: "test-token",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
  EVAL_MODEL: "test-eval-model",
  GITHUB_CONNECTOR: "github/baymi",
  GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
  MODEL: "test-model",
  SLACK_CONNECTOR: "slack/baymi",
};

/**
 * Loads `env.ts` fresh against a stubbed environment. `createEnv` parses at
 * module load, so the module cache has to be dropped for each case.
 */
const loadEnv = async (overrides: Record<string, string> = {}) => {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
  const { env } = await import("#lib/env");
  return env;
};

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves the optional variables unset rather than defaulted", async () => {
    // Stubbed empty rather than omitted: `vi.stubEnv` leaves the rest of the
    // real process environment in place, so a developer with these set in
    // their own shell would otherwise fail this run.
    const env = await loadEnv({
      POSTHOG_API_KEY: "",
      SLACK_NOTIFY_CHANNEL: "",
      SLACK_TEAM_ID: "",
    });
    expect(env.POSTHOG_API_KEY).toBeUndefined();
    expect(env.SLACK_NOTIFY_CHANNEL).toBeUndefined();
    expect(env.SLACK_TEAM_ID).toBeUndefined();
  });

  it("accepts a channel or a member as the place to check in", async () => {
    // A member ID opens a direct message, which is where a solo maintainer
    // usually wants to hear from the agent; a channel works the same way.
    const channel = await loadEnv({ SLACK_NOTIFY_CHANNEL: "C0123456789" });
    expect(channel.SLACK_NOTIFY_CHANNEL).toBe("C0123456789");
    const member = await loadEnv({ SLACK_NOTIFY_CHANNEL: "U0123456789" });
    expect(member.SLACK_NOTIFY_CHANNEL).toBe("U0123456789");
  });

  it("refuses a Slack conversation that is not an ID", async () => {
    await expect(
      loadEnv({ SLACK_NOTIFY_CHANNEL: "#security" })
    ).rejects.toThrow("Invalid environment variables");
  });

  it("takes the model endpoint as given, with no provider prefix assumed", async () => {
    const env = await loadEnv({
      ANTHROPIC_BASE_URL: "https://gateway.example.test/anthropic/v1",
    });
    expect(env.ANTHROPIC_BASE_URL).toBe(
      "https://gateway.example.test/anthropic/v1"
    );
  });

  it("checks a connector UID against its provider", async () => {
    await expect(loadEnv({ SLACK_CONNECTOR: "github/baymi" })).rejects.toThrow(
      "Invalid environment variables"
    );
  });
});
