import { defineConfig } from "vitest/config";

/** Only the opt-in GUI-grounding accuracy benchmark against a real endpoint. */
export default defineConfig({
  test: {
    include: ["bench/grounding-eval.test.ts"],
    testTimeout: 900000,
    hookTimeout: 60000,
    fileParallelism: false
  }
});
