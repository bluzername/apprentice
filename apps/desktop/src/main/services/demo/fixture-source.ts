import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DemoDatasetSchema, FixtureManifestSchema, TEMPLATE_NAMES, type DemoDataset, type FixtureManifest, type TemplateName } from "../../../../../../packages/test-fixtures/src/types.js";

/**
 * Reads demo fixtures from disk. The test-fixtures package resolves its fixture
 * directory from import.meta.url, which is wrong inside the bundled main
 * process, and its index pulls in the native SVG rasterizer; so the desktop app
 * locates the directory itself: env override, packaged resources, or the repo.
 */
export interface FixtureSource {
  readonly dir: string;
  readDemoDataset(): DemoDataset;
  readManifest(): FixtureManifest;
  readScreenshotPng(name: string): Buffer;
  hasDemoDataset(): boolean;
}

export function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

function looksLikeFixturesDir(dir: string): boolean {
  return existsSync(join(dir, "screenshots", "manifest.json"));
}

/** Walks up from `startDir` looking for a `fixtures/` directory with a manifest. */
export function findRepoFixturesDir(startDir: string): string | null {
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, "fixtures");
    if (looksLikeFixturesDir(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function resolveFixturesDir(options: { env?: NodeJS.ProcessEnv; resourcesPath?: string; startDir: string }): string {
  const env = options.env ?? process.env;
  const override = env.APPRENTICE_FIXTURES_DIR?.trim();
  if (override && looksLikeFixturesDir(override)) return override;
  if (options.resourcesPath) {
    const packaged = join(options.resourcesPath, "fixtures");
    if (looksLikeFixturesDir(packaged)) return packaged;
  }
  const found = findRepoFixturesDir(options.startDir);
  if (found) return found;
  throw new Error(`Demo fixtures not found (looked from ${options.startDir}); run "pnpm --filter @apprentice/test-fixtures build"`);
}

export function createFixtureSource(dir: string): FixtureSource {
  const pngCache = new Map<string, Buffer>();
  return {
    dir,
    hasDemoDataset: () => existsSync(join(dir, "demo", "demo-3-days.json")),
    readDemoDataset: () => DemoDatasetSchema.parse(JSON.parse(readFileSync(join(dir, "demo", "demo-3-days.json"), "utf8"))),
    readManifest: () => FixtureManifestSchema.parse(JSON.parse(readFileSync(join(dir, "screenshots", "manifest.json"), "utf8"))),
    readScreenshotPng: (name) => {
      if (!isTemplateName(name)) throw new Error(`Unknown screenshot fixture "${name}"`);
      const cached = pngCache.get(name);
      if (cached) return cached;
      const png = readFileSync(join(dir, "screenshots", `${name}.png`));
      pngCache.set(name, png);
      return png;
    }
  };
}
