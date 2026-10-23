import { defineConfig } from "vitest/config";

/**
 * Unit tests for the logic under `agent/lib/`, colocated with the module they
 * cover. Everything else under `agent/` is wiring that eve boots; see
 * `docs/capability-placement.md`.
 *
 * `agent/lib/env.ts` requires `ANTHROPIC_API_KEY` when it is first imported,
 * and CI's test job has none. The placeholder is for this process only, and it
 * replaces a real key in the developer's shell, so no unit test can reach the
 * API. `eve dev`, `eve eval` and `bun run validate` never read this file, so
 * they still fail by name without the real key.
 */
export default defineConfig({
  test: {
    env: { ANTHROPIC_API_KEY: "test-placeholder" },
    environment: "node",
    include: ["agent/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
