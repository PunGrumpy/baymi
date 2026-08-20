import { defineConfig } from "oxlint";
import antislop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, vitest, antislop],
  ignorePatterns: core.ignorePatterns,
  // eve docs, tools/overview: "The filename is the tool name the model sees."
  // Renaming these to kebab-case would rename the tools out from under the
  // system prompt, which calls them `get_user_preferences` and friends. eve's
  // own examples use snake_case (`get_weather.ts`).
  overrides: [
    {
      files: ["agent/tools/*.ts"],
      rules: { "unicorn/filename-case": "off" },
    },
  ],
  rules: {
    // `@remarks` is TSDoc, which this codebase uses throughout.
    "jsdoc/check-tag-names": ["error", { definedTags: ["remarks"] }],
  },
});
