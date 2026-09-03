import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Icon rasterization takes 5-6 s on GitHub's macOS runners.
    testTimeout: 30000
  }
});
