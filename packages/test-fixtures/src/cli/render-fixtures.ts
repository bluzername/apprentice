/**
 * Renders every SVG screen template to fixtures/screenshots/<name>.png, writes the manifest,
 * and emits scenario and demo JSON fixtures. Run via `pnpm --filter @apprentice/test-fixtures build`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { generateDemoDays } from "../demo.js";
import {
  DEMO_DATASET_PATH,
  DEMO_DIR,
  MANIFEST_PATH,
  SCENARIOS_DIR,
  SCREENSHOTS_DIR,
  scenarioFixturePath,
  screenshotFixturePath
} from "../loaders.js";
import { SCENARIO_GENERATORS } from "../scenarios/index.js";
import { TARGETS, renderTemplatePng } from "../svg/index.js";
import {
  SCENARIO_NAMES,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  TEMPLATE_NAMES,
  type FixtureManifest,
  type FixtureManifestEntry
} from "../types.js";

export const FIXTURE_SEED = 42;
export const FIXTURE_DEMO_DAYS = 3;
/** 2026-09-01T18:00:00Z. Day boundaries are computed in the local timezone of the rendering machine. */
export const FIXTURE_DEMO_END_TS = Date.UTC(2026, 8, 1, 18, 0, 0);
/** 2026-08-24T08:00:00Z, used as the base start for scenario occurrence fixtures. */
export const FIXTURE_SCENARIO_BASE_TS = Date.UTC(2026, 7, 24, 8, 0, 0);
export const SCENARIO_FIXTURE_OCCURRENCES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function renderScreenshots(): readonly FixtureManifestEntry[] {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  return TEMPLATE_NAMES.map((name) => {
    const png = renderTemplatePng(name);
    const path = screenshotFixturePath(name);
    writeFileSync(path, png);
    return {
      name,
      file: `${name}.png`,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      sha256: sha256(png),
      target: TARGETS[name]
    };
  });
}

function writeScenarioFixtures(): readonly string[] {
  mkdirSync(SCENARIOS_DIR, { recursive: true });
  return SCENARIO_NAMES.flatMap((scenario, scenarioIndex) =>
    Array.from({ length: SCENARIO_FIXTURE_OCCURRENCES }, (_, index) => {
      const occurrence = index + 1;
      const episode = SCENARIO_GENERATORS[scenario]({
        seed: FIXTURE_SEED,
        occurrence,
        startTs: FIXTURE_SCENARIO_BASE_TS + index * DAY_MS + scenarioIndex * 60 * 60 * 1000,
        sessionId: `fixture-${scenario}-${occurrence}`,
        seqStart: 0,
        variant: index % 3
      });
      const path = scenarioFixturePath(scenario, occurrence);
      writeFileSync(path, JSON.stringify(episode, null, 2));
      return path;
    })
  );
}

function writeDemoFixture(): string {
  mkdirSync(DEMO_DIR, { recursive: true });
  const dataset = generateDemoDays({ days: FIXTURE_DEMO_DAYS, seed: FIXTURE_SEED, endTs: FIXTURE_DEMO_END_TS });
  writeFileSync(DEMO_DATASET_PATH, JSON.stringify(dataset, null, 2));
  return DEMO_DATASET_PATH;
}

export function renderAllFixtures(): { readonly manifest: FixtureManifest; readonly files: readonly string[] } {
  const entries = renderScreenshots();
  const manifest: FixtureManifest = { version: 1, screenshots: [...entries] };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  const scenarioFiles = writeScenarioFixtures();
  const demoFile = writeDemoFixture();
  const files = [...entries.map((entry) => screenshotFixturePath(entry.name)), MANIFEST_PATH, ...scenarioFiles, demoFile];
  return { manifest, files };
}

function main(): void {
  const { files } = renderAllFixtures();
  const sizes = files.map((file) => ({ file, bytes: statSync(file).size }));
  const total = sizes.reduce((sum, entry) => sum + entry.bytes, 0);
  sizes.forEach((entry) => console.log(`${String(entry.bytes).padStart(9)}  ${entry.file}`));
  console.log(`${files.length} fixture files, ${(total / 1024 / 1024).toFixed(2)} MB total`);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
