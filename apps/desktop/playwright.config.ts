import { defineConfig } from "@playwright/test";

/**
 * Electron demo-mode journey. One serial spec drives the real renderer with
 * the `--e2e` launch flag (fixture screens, fake helper, temp data dir).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" }
});
