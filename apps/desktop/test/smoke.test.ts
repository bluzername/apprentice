import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import electronPath from "electron";
import { REPO_ROOT, tempDir } from "./helpers.js";

const execFileAsync = promisify(execFile);
const DESKTOP = join(REPO_ROOT, "apps", "desktop");
const ENTRY = join(DESKTOP, "out", "main", "index.js");

describe("headless smoke test (--smoke-test)", () => {
  it("runs the built app end to end and prints ok:true", async () => {
    if (!existsSync(ENTRY)) {
      await execFileAsync(join(REPO_ROOT, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: DESKTOP, timeout: 300_000 });
    }
    const dataDir = tempDir("smoke-");
    const { stdout } = await execFileAsync(String(electronPath), [ENTRY, "--smoke-test"], {
      cwd: DESKTOP,
      env: { ...process.env, APPRENTICE_DATA_DIR: dataDir, ELECTRON_RUN_AS_NODE: undefined },
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024
    });
    const line = stdout.trim().split("\n").filter((entry) => entry.startsWith("{")).pop();
    expect(line).toBeDefined();
    const result = JSON.parse(line!) as { ok: boolean; candidates: number; runStatus: string; steps: number; bundle: string; skillId: string };
    expect(result.ok).toBe(true);
    expect(result.candidates).toBeGreaterThanOrEqual(1);
    expect(result.runStatus).toBe("completed");
    expect(result.steps).toBeGreaterThan(0);
    expect(result.skillId).toMatch(/^skill_/);
    expect(existsSync(result.bundle)).toBe(true);
  }, 600_000);
});
