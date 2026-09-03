import { decodePngToPixels, newId, perceptualHash } from "@apprentice/core";
import { MockVisionAgentProvider, uimate, type VisionAgentProvider } from "@apprentice/model-adapters";
import type { OcrResult, ScreenshotRecord, Skill } from "@apprentice/schemas";
import { generateDemoDays } from "../../../../../../packages/test-fixtures/src/demo.js";
import { SCENARIO_NAMES, type DemoDataset, type ScenarioName, type TemplateName } from "../../../../../../packages/test-fixtures/src/types.js";
import type { Analytics } from "../analytics.js";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import type { DiscoveryScheduler } from "../discovery/scheduler.js";
import type { Logger } from "../logger.js";
import type { ScreenSource } from "../observation/screen-source.js";
import type { Actuator, AppActivator, AxSource, DomStateSource, OcrSource, RunContextSource } from "../runs/types.js";
import type { SettingsStore } from "../settings-store.js";
import type { Switchable } from "../switchable.js";
import type { FixtureSource } from "./fixture-source.js";
import { DEMO_SCREEN_STATES } from "./screen-states.js";
import { buildDemoScript } from "./script-builder.js";
import { DemoActuator, DemoScreenSimulator, type TemplateTarget } from "./simulator.js";

export const DEMO_META_KEY = "demo.state";
const DEMO_SEED = 42;
const DATASET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface DemoStatus {
  readonly loaded: boolean;
  readonly daysSimulated: number;
  readonly scenario: string[];
}

interface DemoMeta {
  readonly days: number;
  readonly scenarios: readonly ScenarioName[];
  readonly sessionIds: readonly string[];
}

export type ScenarioRequest = "post_meeting_followup" | "invoice_processing" | "candidate_review";
const SCENARIO_BY_REQUEST: Readonly<Record<ScenarioRequest, ScenarioName>> = { post_meeting_followup: "postMeetingFollowup", invoice_processing: "invoiceProcessing", candidate_review: "candidateReview" };

export interface DemoServiceDeps {
  readonly storage: StorageRef;
  readonly settings: SettingsStore;
  readonly fixtures: FixtureSource;
  readonly scheduler: DiscoveryScheduler;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly screenSource: Switchable<ScreenSource>;
  readonly actuator: Switchable<Actuator>;
  readonly appActivator: Switchable<AppActivator>;
  readonly context: Switchable<RunContextSource>;
  readonly ocr: Switchable<OcrSource>;
  readonly ax: Switchable<AxSource>;
  readonly dom: Switchable<DomStateSource>;
  readonly setProviderOverride: (provider: VisionAgentProvider | null) => void;
  readonly realSources: { screen: ScreenSource; actuator: Actuator; appActivator: AppActivator; context: RunContextSource; ocr: OcrSource; ax: AxSource; dom: DomStateSource };
}

/** Demo mode: synthetic days in the database, fixture screens for runs, scripted mock model. */
export class DemoService {
  private simulator: DemoScreenSimulator | null = null;
  private targets: Readonly<Record<string, TemplateTarget>> | null = null;
  private readonly hashCache = new Map<string, string>();

  constructor(private readonly deps: DemoServiceDeps) {}

  private readMeta(): DemoMeta | null {
    const raw = this.deps.storage.current.meta.get(DEMO_META_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as DemoMeta;
    } catch {
      return null;
    }
  }

  status(): DemoStatus {
    const meta = this.readMeta();
    return meta ? { loaded: true, daysSimulated: meta.days, scenario: [...meta.scenarios] } : { loaded: false, daysSimulated: 0, scenario: [] };
  }

  /** Session ids whose data retention must leave alone while demo mode is on. */
  sessionIds(): ReadonlySet<string> {
    return new Set(this.deps.settings.get().demoMode ? (this.readMeta()?.sessionIds ?? []) : []);
  }

  isActive(): boolean {
    return this.deps.settings.get().demoMode && this.readMeta() !== null;
  }

  /** Restores the fixture sources after a restart when demo mode was left on. */
  restore(): void {
    if (this.isActive()) this.activateSources();
  }

  private dataset(days: number, scenarios: readonly ScenarioName[]): DemoDataset {
    const now = this.deps.clock.now();
    const allScenarios = scenarios.length === SCENARIO_NAMES.length;
    if (days === 3 && allScenarios && this.deps.fixtures.hasDemoDataset()) {
      const stored = this.deps.fixtures.readDemoDataset();
      if (now - stored.endTs <= DATASET_MAX_AGE_MS && stored.endTs <= now + 60_000) return stored;
      this.deps.logger.info("demo dataset on disk is outside the retention window; generating a fresh one");
    }
    return generateDemoDays({ days: Math.max(2, days), seed: DEMO_SEED, endTs: now, scenarios, sessionIdPrefix: `demo-${now.toString(36)}` });
  }

  private hashOf(template: TemplateName): string {
    const cached = this.hashCache.get(template);
    if (cached) return cached;
    const hash = perceptualHash(decodePngToPixels(this.deps.fixtures.readScreenshotPng(template)));
    this.hashCache.set(template, hash);
    return hash;
  }

  private ocrFor(template: TemplateName, screenshotId: string, ts: number, width: number, height: number): OcrResult {
    const state = DEMO_SCREEN_STATES[template];
    const target = this.loadTargets()[template];
    const words = [...(target ? [target.label] : []), ...state.words];
    const blocks = words.map((text, index) => ({ text, x: target && index === 0 ? target.x - 40 : 24, y: target && index === 0 ? target.y - 11 : 24 + index * 28, width: Math.max(40, text.length * 9), height: 22, confidence: 0.95 }));
    return { id: newId("ocr"), screenshotId, ts, width, height, blocks };
  }

  private loadTargets(): Readonly<Record<string, TemplateTarget>> {
    if (this.targets) return this.targets;
    const manifest = this.deps.fixtures.readManifest();
    this.targets = Object.fromEntries(manifest.screenshots.map((entry) => [entry.name, { label: entry.target.label, x: entry.target.x, y: entry.target.y }]));
    return this.targets;
  }

  load(days = 3, requested?: readonly ScenarioRequest[]): DemoStatus {
    if (this.readMeta()) this.reset();
    const scenarios: readonly ScenarioName[] = requested && requested.length > 0 ? requested.map((name) => SCENARIO_BY_REQUEST[name]) : SCENARIO_NAMES;
    const data = this.dataset(days, scenarios);
    const storage = this.deps.storage.current;
    storage.events.insertMany(data.events);
    for (const shot of data.screenshots) {
      const png = this.deps.fixtures.readScreenshotPng(shot.fixtureName);
      const written = storage.blobs.write(shot.id, png);
      const record: ScreenshotRecord = {
        id: shot.id,
        ts: shot.ts,
        sessionId: shot.sessionId,
        eventId: shot.eventId,
        width: shot.width,
        height: shot.height,
        displayScale: 1,
        perceptualHash: this.hashOf(shot.fixtureName),
        byteLength: written.byteLength,
        reason: shot.reason,
        analyzed: true,
        app: shot.app,
        domain: shot.domain
      };
      storage.screenshots.insert(record);
      storage.screenshots.insertOcr(this.ocrFor(shot.fixtureName, shot.id, shot.ts, shot.width, shot.height));
    }
    const meta: DemoMeta = { days: data.days, scenarios, sessionIds: data.sessions.map((session) => session.id) };
    storage.meta.set(DEMO_META_KEY, JSON.stringify(meta));
    const settings = this.deps.settings.get();
    const demoApps = [...new Set(data.events.map((event) => event.app?.bundleId).filter((id): id is string => id !== undefined))].map((bundleId) => ({ bundleId, name: bundleId.split(".").pop() ?? bundleId }));
    const demoDomains = [...new Set(data.events.map((event) => event.domain).filter((domain): domain is string => domain !== undefined))].filter((domain) => domain.endsWith(".example"));
    this.deps.settings.update({
      demoMode: true,
      allowlist: {
        apps: [...settings.allowlist.apps, ...demoApps.filter((app) => !settings.allowlist.apps.some((existing) => existing.bundleId === app.bundleId))],
        domains: [...new Set([...settings.allowlist.domains, ...demoDomains])]
      }
    });
    const discovery = this.deps.scheduler.runNow();
    this.activateSources();
    this.deps.analytics.track("demo_loaded", { days: data.days, events: data.events.length, candidates: discovery.candidates });
    return this.status();
  }

  private activateSources(): void {
    const simulator = new DemoScreenSimulator({ readPng: (name) => this.deps.fixtures.readScreenshotPng(name), targets: this.loadTargets(), now: () => this.deps.clock.now() });
    this.simulator = simulator;
    this.deps.screenSource.use(simulator);
    this.deps.actuator.use(new DemoActuator(simulator));
    // Demo screens are fixtures; the simulated frontmost app follows the timeline, so nothing real is activated.
    this.deps.appActivator.use({ activate: async () => ({ activated: true }) });
    this.deps.context.use({ frontmost: async () => simulator.context() });
    this.deps.ocr.use({ ocr: async (_png, width, height) => simulator.ocrBlocks(width, height) });
    this.deps.ax.use({ elementAt: async () => ({ element: null }) });
    this.deps.dom.use({ query: async (marker) => ({ marker, present: simulator.state().domMarkers.includes(marker), domain: simulator.state().domain, path: simulator.state().path }) });
  }

  /** Run-engine hook: install the scripted provider and screen timeline for this skill. */
  async prepareRun(skill: Skill): Promise<void> {
    if (!this.isActive() || !this.simulator) return;
    const png = this.deps.fixtures.readScreenshotPng("genericBlank");
    const original = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    const resized = uimate.processImageDims(original.width, original.height);
    const script = buildDemoScript(skill, { original, resized, targets: this.loadTargets() });
    this.simulator.loadTimeline(script.timeline);
    this.deps.setProviderOverride(new MockVisionAgentProvider({ script: script.script, now: () => this.deps.clock.now() }));
    this.deps.logger.info("demo run prepared", { scenario: script.scenario, steps: script.timeline.length });
  }

  /** Run-engine hook: the run advanced to `index`; show that subtask's first screen. */
  advanceSubtask(index: number): void {
    this.simulator?.advanceToSubtask(index);
  }

  reset(): DemoStatus {
    const meta = this.readMeta();
    const storage = this.deps.storage.current;
    if (meta) {
      const sessions = new Set(meta.sessionIds);
      const eventIds = storage.db.all<{ id: string }>("SELECT id FROM events").map((row) => row.id);
      const demoEventIds = eventIds.length > 0 ? storage.db.all<{ id: string }>(`SELECT id FROM events WHERE session_id IN (${[...sessions].map(() => "?").join(",")})`, ...sessions).map((row) => row.id) : [];
      storage.events.deleteByIds(demoEventIds);
      const shotIds = storage.db.all<{ id: string }>(`SELECT id FROM screenshots WHERE session_id IN (${[...sessions].map(() => "?").join(",")})`, ...sessions).map((row) => row.id);
      for (const id of shotIds) storage.blobs.delete(id);
      storage.screenshots.deleteByIds(shotIds);
      const episodes = storage.episodes.all().filter((episode) => sessions.has(episode.sessionId));
      const episodeIds = new Set(episodes.map((episode) => episode.id));
      storage.episodes.deleteByIds([...episodeIds]);
      for (const candidate of storage.candidates.list(true)) {
        if (candidate.evidenceEpisodeIds.some((id) => episodeIds.has(id))) storage.candidates.delete(candidate.id);
      }
      for (const skill of storage.skills.listCurrent()) {
        if (skill.source === "demo" || skill.evidence.episodeIds.some((id) => episodeIds.has(id))) {
          storage.runs.deleteBySkill(skill.id);
          storage.skills.delete(skill.id);
        }
      }
      storage.meta.delete(DEMO_META_KEY);
    }
    this.deps.settings.update({ demoMode: false });
    this.deps.setProviderOverride(null);
    this.deps.screenSource.use(this.deps.realSources.screen);
    this.deps.actuator.use(this.deps.realSources.actuator);
    this.deps.appActivator.use(this.deps.realSources.appActivator);
    this.deps.context.use(this.deps.realSources.context);
    this.deps.ocr.use(this.deps.realSources.ocr);
    this.deps.ax.use(this.deps.realSources.ax);
    this.deps.dom.use(this.deps.realSources.dom);
    this.simulator = null;
    this.deps.scheduler.runNow();
    return this.status();
  }
}
