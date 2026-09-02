import { defineConfig } from "vitest/config";

/** Only the opt-in smoke test against a real OpenAI-compatible endpoint. */
export default defineConfig({
  test: {
    include: ["test/local-model.test.ts"],
    testTimeout: 180000,
    hookTimeout: 60000
  }
});
