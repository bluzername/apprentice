import { defineConfig } from "vitest/config";

/**
 * Default unit suite. The opt-in real-endpoint smoke test lives in
 * test/local-model.test.ts and is excluded here so `pnpm test` has zero skips;
 * run it with `pnpm test:local-model` (see vitest.local-model.config.ts).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "bench/grounding-score.test.ts"],
    exclude: ["**/node_modules/**", "test/local-model.test.ts"]
  }
});
