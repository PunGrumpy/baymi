import { defineConfig } from "vitest/config";

/**
 * Unit tests for the logic under `agent/lib/`, colocated with the module they
 * cover. Everything else under `agent/` is wiring that eve boots; see
 * `docs/capability-placement.md`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["agent/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
