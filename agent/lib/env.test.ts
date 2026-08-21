import { afterEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  ANTHROPIC_API_KEY: "test-token",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
  DIGEST_REPOS: "acme/widgets,acme/docs",
  DIGEST_SLACK_CHANNEL: "C0123456789",
  EVAL_MODEL: "test-eval-model",
  GITHUB_CONNECTOR: "github/baymi",
  LINEAR_CONNECTOR: "linear/baymi",
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

  it("leaves the telemetry variables unset rather than defaulted", async () => {
    // A fresh checkout has no PostHog project. The wide events are still
    // recorded; what is absent is the destination and the weekly report, and
    // a default here would point both at somebody else's project. Stubbed
    // empty rather than omitted: `vi.stubEnv` leaves the rest of the real
    // process environment in place, so a developer with these set in their
    // own shell would otherwise fail this run.
    const env = await loadEnv({
      MODEL_COST_PER_MTOK: "",
      POSTHOG_API_KEY: "",
      POSTHOG_PERSONAL_API_KEY: "",
    });
    expect(env.POSTHOG_API_KEY).toBeUndefined();
    expect(env.POSTHOG_PERSONAL_API_KEY).toBeUndefined();
    expect(env.MODEL_COST_PER_MTOK).toBeUndefined();
  });

  it("parses MODEL_COST_PER_MTOK into a price, not the raw string", async () => {
    // The hook reads `.input` and `.output` off it; a plain string here
    // type-checks against nothing and reaches evlog as an invalid cost map.
    const env = await loadEnv({ MODEL_COST_PER_MTOK: "0.6,2.2" });
    expect(env.MODEL_COST_PER_MTOK).toStrictEqual({ input: 0.6, output: 2.2 });
  });

  it("parses DIGEST_REPOS into a list, not the raw string", async () => {
    const env = await loadEnv();
    // Guards the schedule's `for (const repo of env.DIGEST_REPOS)`: a plain
    // string here type-checks and then iterates one character at a time.
    expect(Array.isArray(env.DIGEST_REPOS)).toBeTruthy();
    expect(env.DIGEST_REPOS).toStrictEqual(["acme/widgets", "acme/docs"]);
  });

  it("takes the model endpoint as given, with no provider prefix assumed", async () => {
    // The base URL points at an Anthropic-compatible endpoint that need not be
    // Anthropic's own, so the key carries no `sk-` shape and the URL is the
    // only thing that decides which service answers.
    const env = await loadEnv({
      ANTHROPIC_BASE_URL: "https://gateway.example.test/anthropic/v1",
    });
    expect(env.ANTHROPIC_BASE_URL).toBe(
      "https://gateway.example.test/anthropic/v1"
    );
  });

  it("keeps the agent model and the eval model independent", async () => {
    // Two variables rather than one so a run can be graded by a model other
    // than the one under test. Reading the same value into both would make a
    // judged score self-assessment without saying so.
    const env = await loadEnv({
      EVAL_MODEL: "vendor/grader",
      MODEL: "vendor/candidate",
    });
    expect(env.MODEL).toBe("vendor/candidate");
    expect(env.EVAL_MODEL).toBe("vendor/grader");
  });

  it("rejects a base URL that is not a URL", async () => {
    await expect(loadEnv({ ANTHROPIC_BASE_URL: "not-a-url" })).rejects.toThrow(
      /invalid environment variables/iu
    );
  });
});
