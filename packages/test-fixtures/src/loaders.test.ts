import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_SCENARIO_BASE_TS, FIXTURE_SEED, SCENARIO_FIXTURE_OCCURRENCES } from "./cli/render-fixtures.js";
import {
  DEMO_DATASET_PATH,
  FIXTURES_DIR,
  SCREENSHOTS_DIR,
  listScenarios,
  loadDemoDataset,
  loadFixtureManifest,
  loadFixtureScreenshotPng,
  loadScenarioFixture,
  scenarioFixturePath,
  screenshotFixturePath
} from "./loaders.js";
import { SCENARIO_GENERATORS } from "./scenarios/index.js";
import { TARGETS, renderTemplatePng } from "./svg/index.js";
import { SCENARIO_NAMES, TEMPLATE_NAMES } from "./types.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FIXTURE_BYTES = 15 * 1024 * 1024;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function directorySize(dir: string): number {
  return readdirSync(dir).reduce((sum, entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    return sum + (stats.isDirectory() ? directorySize(path) : stats.size);
  }, 0);
}

describe("screenshot fixtures", () => {
  const manifest = loadFixtureManifest();

  it("lists every template with its target", () => {
    expect(manifest.screenshots.map((entry) => entry.name).sort()).toEqual([...TEMPLATE_NAMES].sort());
    manifest.screenshots.forEach((entry) => {
      expect(entry.target).toEqual(TARGETS[entry.name]);
      expect(entry.width).toBe(1440);
      expect(entry.height).toBe(900);
    });
  });

  it.each(TEMPLATE_NAMES)("%s PNG on disk matches the manifest sha256 and a fresh render", (name) => {
    const entry = manifest.screenshots.find((candidate) => candidate.name === name);
    const onDisk = loadFixtureScreenshotPng(name);
    expect(onDisk.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(sha256(onDisk)).toBe(entry?.sha256);
    expect(sha256(renderTemplatePng(name))).toBe(entry?.sha256);
    expect(existsSync(screenshotFixturePath(name))).toBe(true);
  });

  it("rejects unknown screenshot names", () => {
    expect(() => loadFixtureScreenshotPng("../etc/passwd")).toThrow(/Unknown screenshot fixture/);
  });
});

describe("scenario fixtures", () => {
  it("lists the three scenarios", () => {
    expect(listScenarios()).toEqual([...SCENARIO_NAMES]);
  });

  it.each(SCENARIO_NAMES)("%s occurrence files equal a regeneration with the fixture seed", (scenario) => {
    const scenarioIndex = SCENARIO_NAMES.indexOf(scenario);
    Array.from({ length: SCENARIO_FIXTURE_OCCURRENCES }, (_, index) => index + 1).forEach((occurrence) => {
      expect(existsSync(scenarioFixturePath(scenario, occurrence))).toBe(true);
      const loaded = loadScenarioFixture(scenario, occurrence);
      const regenerated = SCENARIO_GENERATORS[scenario]({
        seed: FIXTURE_SEED,
        occurrence,
        startTs: FIXTURE_SCENARIO_BASE_TS + (occurrence - 1) * DAY_MS + scenarioIndex * 60 * 60 * 1000,
        sessionId: `fixture-${scenario}-${occurrence}`,
        seqStart: 0,
        variant: (occurrence - 1) % 3
      });
      expect(loaded).toEqual(regenerated);
    });
  });
});

describe("demo fixture", () => {
  it("loads and validates the 3-day dataset", () => {
    expect(existsSync(DEMO_DATASET_PATH)).toBe(true);
    const dataset = loadDemoDataset();
    expect(dataset.seed).toBe(FIXTURE_SEED);
    expect(dataset.days).toBe(3);
    SCENARIO_NAMES.forEach((scenario) => expect(dataset.episodesExpected[scenario]).toBe(3));
    const manifestNames = new Set(loadFixtureManifest().screenshots.map((entry) => entry.name));
    dataset.screenshots.forEach((shot) => expect(manifestNames.has(shot.fixtureName)).toBe(true));
  });

  it("keeps the whole fixtures directory under 15 MB", () => {
    expect(directorySize(FIXTURES_DIR)).toBeLessThan(MAX_FIXTURE_BYTES);
    expect(readdirSync(SCREENSHOTS_DIR).filter((file) => file.endsWith(".png"))).toHaveLength(TEMPLATE_NAMES.length);
    expect(readFileSync(join(SCREENSHOTS_DIR, "manifest.json"), "utf8")).toContain('"version": 1');
  });
});
