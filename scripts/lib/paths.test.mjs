import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR_ENV, appSupportDir, logsDir, mlxVenvDir, modelsDir, productName, runtimeDir } from "./paths.mjs";

describe("paths", () => {
  const original = process.env[DATA_DIR_ENV];
  afterEach(() => {
    if (original === undefined) {
      delete process.env[DATA_DIR_ENV];
    } else {
      process.env[DATA_DIR_ENV] = original;
    }
  });

  it("reads the product name from branding.ts", () => {
    expect(productName()).toBe("Apprentice");
  });

  it("defaults to ~/Library/Application Support/<product>", () => {
    delete process.env[DATA_DIR_ENV];
    expect(appSupportDir()).toBe(join(homedir(), "Library", "Application Support", "Apprentice"));
    expect(runtimeDir()).toBe(join(appSupportDir(), "runtime"));
    expect(modelsDir()).toBe(join(appSupportDir(), "models"));
    expect(logsDir()).toBe(join(appSupportDir(), "logs"));
    expect(mlxVenvDir()).toBe(join(appSupportDir(), "mlx-venv"));
  });

  it("honours the APPRENTICE_DATA_DIR override", () => {
    process.env[DATA_DIR_ENV] = "/tmp/apprentice-test-data/";
    expect(appSupportDir()).toBe("/tmp/apprentice-test-data");
    expect(runtimeDir()).toBe("/tmp/apprentice-test-data/runtime");
    process.env[DATA_DIR_ENV] = "   ";
    expect(appSupportDir()).toContain("Application Support");
  });
});
