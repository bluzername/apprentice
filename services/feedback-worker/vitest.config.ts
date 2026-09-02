import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { ADMIN_TOKEN: "test-admin-token", TEST_MIGRATIONS: migrations },
          d1Databases: ["DB"]
        }
      })
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      fileParallelism: false
    }
  };
});
