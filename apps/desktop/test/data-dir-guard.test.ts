import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertIsolatedDataDir, ISOLATED_DATA_DIR_ERROR } from "../src/main/security/keys.js";
import { tempDir } from "./helpers.js";

/** Mirrors the layout of ~/Library/Application Support/<product> inside a temp dir. */
function layout(): { defaultRoot: string; sibling: string } {
  const base = tempDir("data-dir-guard-");
  const defaultRoot = join(base, "Application Support", "Apprentice");
  const sibling = join(base, "isolated");
  mkdirSync(defaultRoot, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  return { defaultRoot, sibling };
}

describe("assertIsolatedDataDir", () => {
  it("rejects an unset or blank APPRENTICE_DATA_DIR", () => {
    const { defaultRoot } = layout();
    expect(() => assertIsolatedDataDir(undefined, defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
    expect(() => assertIsolatedDataDir("", defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
    expect(() => assertIsolatedDataDir("   ", defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
  });

  it("rejects the default root itself, with a trailing slash, and through a symlink", () => {
    const { defaultRoot, sibling } = layout();
    expect(() => assertIsolatedDataDir(defaultRoot, defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
    expect(() => assertIsolatedDataDir(`${defaultRoot}/`, defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
    expect(() => assertIsolatedDataDir(join(defaultRoot, "..", "Apprentice"), defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
    const link = join(sibling, "link-to-real");
    symlinkSync(defaultRoot, link);
    expect(() => assertIsolatedDataDir(link, defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
  });

  it("rejects a directory nested inside the default root", () => {
    const { defaultRoot } = layout();
    expect(() => assertIsolatedDataDir(join(defaultRoot, "nested"), defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
    expect(() => assertIsolatedDataDir(join(defaultRoot, "a", "b"), defaultRoot)).toThrow(ISOLATED_DATA_DIR_ERROR);
  });

  it("accepts a different directory and returns its canonical path", () => {
    const { defaultRoot, sibling } = layout();
    expect(assertIsolatedDataDir(sibling, defaultRoot)).toBe(realpathSync(sibling));
    // Not-yet-created leaves are canonicalised through their deepest existing ancestor (tmpdir is a symlink on macOS).
    expect(assertIsolatedDataDir(join(sibling, "fresh", "smoke-data"), defaultRoot)).toBe(join(realpathSync(sibling), "fresh", "smoke-data"));
    // A sibling whose name merely starts with the default root's name is still outside it.
    expect(assertIsolatedDataDir(`${defaultRoot}-copy`, defaultRoot)).toBe(`${realpathSync(defaultRoot)}-copy`);
  });
});
