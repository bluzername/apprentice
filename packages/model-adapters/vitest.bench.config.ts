import { defineConfig } from "vitest/config";

/** Only the opt-in latency and resource benchmark against a real endpoint. */
export default defineConfig({
  test: {
    include: ["bench/local-model-bench.test.ts"],
    testTimeout: 900000,
    hookTimeout: 60000,
    fileParallelism: false
  }
});
