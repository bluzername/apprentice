import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@main": resolve(__dirname, "src/main") } },
  test: { include: ["test/**/*.test.ts", "src/main/**/*.test.ts", "src/renderer/src/**/*.test.ts"], environment: "node", testTimeout: 20000 }
});
