import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ZIP_NAME, listFiles, packageZip, validateEntryName } from "../scripts/package-zip";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("validateEntryName", () => {
  it("accepts relative forward-slash names", () => {
    expect(validateEntryName("manifest.json")).toBe("manifest.json");
    expect(validateEntryName("icons/icon-16.png")).toBe("icons/icon-16.png");
  });

  it("rejects absolute paths, traversal, and empty segments", () => {
    expect(() => validateEntryName("/etc/passwd")).toThrow();
    expect(() => validateEntryName("C:evil.txt")).toThrow();
    expect(() => validateEntryName("../outside.js")).toThrow();
    expect(() => validateEntryName("icons/../../x")).toThrow();
    expect(() => validateEntryName("a//b")).toThrow();
    expect(() => validateEntryName("")).toThrow();
  });
});

describe("packageZip", () => {
  it("zips every file except the zip itself and reports a matching sha256", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apprentice-zip-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "manifest.json"), "{}");
    await mkdir(join(dir, "icons"));
    await writeFile(join(dir, "icons", "icon-16.png"), "png");
    await mkdir(join(dir, ".vite"));
    await writeFile(join(dir, ".vite", "manifest.json"), "ignored");
    const files = await listFiles(dir);
    expect(files.map((file) => file.slice(dir.length + 1))).toEqual(["icons/icon-16.png", "manifest.json"]);
    const result = await packageZip(dir);
    expect(result.path).toBe(join(dir, ZIP_NAME));
    expect(result.entries).toBe(2);
    const bytes = await readFile(result.path);
    expect(result.size).toBe(bytes.length);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(result.sha256);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  });

  it("refuses to package an empty directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apprentice-empty-"));
    tempDirs.push(dir);
    await expect(packageZip(dir)).rejects.toThrow(/Nothing to package/);
  });
});
