import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DemoDatasetSchema,
  FixtureManifestSchema,
  GeneratedEpisodeSchema,
  SCENARIO_NAMES,
  TEMPLATE_NAMES,
  type DemoDataset,
  type FixtureManifest,
  type GeneratedEpisode,
  type ScenarioName,
  type TemplateName
} from "./types.js";

const PACKAGE_SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Repo-level fixtures directory, resolved relative to this package. */
export const FIXTURES_DIR = resolve(PACKAGE_SRC_DIR, "..", "..", "..", "fixtures");
export const SCREENSHOTS_DIR = join(FIXTURES_DIR, "screenshots");
export const SCENARIOS_DIR = join(FIXTURES_DIR, "scenarios");
export const DEMO_DIR = join(FIXTURES_DIR, "demo");
export const MANIFEST_PATH = join(SCREENSHOTS_DIR, "manifest.json");
export const DEMO_DATASET_PATH = join(DEMO_DIR, "demo-3-days.json");

export function screenshotFixturePath(name: TemplateName): string {
  return join(SCREENSHOTS_DIR, `${name}.png`);
}

export function scenarioFixturePath(scenario: ScenarioName, occurrence: number): string {
  return join(SCENARIOS_DIR, `${scenario}.occurrence-${occurrence}.json`);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}. Run "pnpm --filter @apprentice/test-fixtures build" first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function loadFixtureScreenshotPng(name: string): Buffer {
  if (!(TEMPLATE_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown screenshot fixture "${name}". Known: ${TEMPLATE_NAMES.join(", ")}`);
  }
  const path = screenshotFixturePath(name as TemplateName);
  if (!existsSync(path)) {
    throw new Error(`Screenshot fixture missing: ${path}. Run "pnpm --filter @apprentice/test-fixtures build" first.`);
  }
  return readFileSync(path);
}

export function loadFixtureManifest(): FixtureManifest {
  return FixtureManifestSchema.parse(readJson(MANIFEST_PATH));
}

export function loadDemoDataset(): DemoDataset {
  return DemoDatasetSchema.parse(readJson(DEMO_DATASET_PATH));
}

export function loadScenarioFixture(scenario: ScenarioName, occurrence: number): GeneratedEpisode {
  return GeneratedEpisodeSchema.parse(readJson(scenarioFixturePath(scenario, occurrence)));
}

export function listScenarios(): readonly ScenarioName[] {
  return [...SCENARIO_NAMES];
}
