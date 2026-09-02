import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillFromDraft, type CoreSkillDraft } from "@apprentice/core";
import type { Episode, Run, ScreenshotRecord } from "@apprentice/schemas";
import { demoSkillTemplates } from "@apprentice/test-fixtures";
import { createManualClock, systemClock, type Clock } from "../src/main/services/clock.js";
import { silentLogger } from "../src/main/services/logger.js";
import { PrivacyService } from "../src/main/services/privacy/privacy-service.js";
import { fixtures, makeContext, scenarioEvents } from "./helpers.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function build(clock: Clock = systemClock) {
  const context = makeContext();
  const calls = { quiesce: 0, afterReset: 0 };
  const privacy = new PrivacyService({
    context,
    analytics: context.analytics,
    clock,
    logger: silentLogger,
    quiesce: async () => {
      calls.quiesce += 1;
    },
    afterReset: async () => {
      calls.afterReset += 1;
    },
    securePauseCount: () => 2,
    retentionExcludedSessions: () => new Set()
  });
  return { context, privacy, calls };
}

function shot(context: ReturnType<typeof makeContext>, id: string, ts: number, analyzed = true): ScreenshotRecord {
  const written = context.storage.current.blobs.write(id, fixtures.readScreenshotPng("genericBlank"));
  const record: ScreenshotRecord = { id, ts, sessionId: "s", width: 1440, height: 900, displayScale: 1, perceptualHash: "0000000000000000", byteLength: written.byteLength, reason: "demo", analyzed };
  context.storage.current.screenshots.insert(record);
  context.storage.current.screenshots.insertOcr({ id: `ocr-${id}`, screenshotId: id, ts, width: 10, height: 10, blocks: [] });
  return record;
}

describe("privacy service", () => {
  it("deleteToday removes only today's events, screenshots, and OCR", () => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const clock = createManualClock(noon.getTime());
    const { context, privacy } = build(clock);
    const now = clock.now();
    context.storage.current.events.insertMany([...scenarioEvents("postMeetingFollowup", 1, "today", now - 2 * HOUR), ...scenarioEvents("postMeetingFollowup", 2, "yesterday", now - 2 * DAY)]);
    shot(context, "today-shot", now - 30_000);
    shot(context, "old-shot", now - 2 * DAY);
    const result = privacy.deleteToday();
    expect(result.deletedScreenshots).toBe(1);
    expect(result.deletedEvents).toBeGreaterThan(0);
    expect(context.storage.current.screenshots.get("today-shot")).toBeNull();
    expect(context.storage.current.blobs.exists("today-shot")).toBe(false);
    expect(context.storage.current.screenshots.get("old-shot")).not.toBeNull();
    expect(context.storage.current.events.query({ sessionId: "yesterday", limit: 10 }).length).toBeGreaterThan(0);
    expect(context.storage.current.events.query({ sessionId: "today", limit: 10 })).toHaveLength(0);
    expect(privacy.stats().activeExclusions.some((line) => line.includes("secure-field pauses"))).toBe(true);
  });

  it("deleteSkillData removes versions, runs, run feedback, and the candidate link", () => {
    const { context, privacy } = build();
    const storage = context.storage.current;
    const skill = storage.skills.save(skillFromDraft(demoSkillTemplates.invoiceProcessing as unknown as CoreSkillDraft, { source: "candidate", evidence: { episodeIds: [], candidateId: "cand_x" }, mode: "guide" }));
    storage.skills.save({ ...skill, version: 2, name: "v2" });
    const run: Run = { id: "run_p", skillId: skill.id, skillVersion: 2, skillName: "x", mode: "guide", status: "completed", currentSubtaskIndex: 0, subtaskCount: 1, startedAt: 1, failureCategory: "none", provider: "mock", metrics: { steps: 0, approvedActions: 0, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 0, modelLatencyMsMax: 0, screenshotsUsed: 0 }, lowRiskRunApproval: false, navigationRunApproval: false, summary: "" };
    storage.runs.save(run);
    storage.feedback.save({ id: "fb_p", contextType: "run", contextId: "run_p", answers: { kind: "general", sentiment: "positive" }, consent: { localStored: true, remoteUpload: false, commentWarningShown: false }, sanitization: { ok: true, removedFields: [] }, uploadStatus: "local_only", appVersion: "t", modelInfo: { provider: "mock" }, performance: {}, createdAt: 1 });
    storage.candidates.upsert({ id: "cand_x", source: "passive", evidenceEpisodeIds: ["ep"], similarity: { meanPairwise: 1, minPairwise: 1, weightedLcs: 1, editSimilarity: 1, appTransitionSimilarity: 1, durationConsistency: 1 }, repeatCount: 2, medianDurationMs: 1000, estimatedWeeklyFrequency: 1, estimatedWeeklyMinutes: 1, deterministicTitle: "t", trigger: "t", steps: [], variables: [], expectedOutcome: "o", confidence: 0.5, confidenceExplanation: "e", scoreComponents: { sequenceSimilarity: 1, repeatCount: 1, triggerConsistency: 1, outcomeConsistency: 1, timeCost: 1, lowRiskCoverage: 1 }, riskClass: "unknown", suppression: { state: "converted" }, apps: [], domains: [], createdAt: 1, updatedAt: 1, patternKey: "pk" });
    expect(privacy.deleteSkillData(skill.id)).toBe(true);
    expect(storage.skills.history(skill.id)).toHaveLength(0);
    expect(storage.runs.get("run_p")).toBeNull();
    expect(storage.feedback.count()).toBe(0);
    expect(storage.candidates.get("cand_x")).toBeNull();
    expect(() => privacy.deleteSkillData("missing")).toThrow(/not found/);
  });

  it("deleteAll wipes files and rows, keeps shared model files unless asked, and issues a new installation id", async () => {
    const { context, privacy, calls } = build();
    const paths = context.paths;
    const before = context.settings.get().installationId;
    context.storage.current.events.insertMany(scenarioEvents("candidateReview", 1, "s", Date.now() - HOUR));
    shot(context, "all-shot", Date.now());
    writeFileSync(join(paths.exports, "bundle.zip"), "zip");
    writeFileSync(join(paths.logs, "app.log"), "log");
    writeFileSync(join(paths.modelCaches, "cache.bin"), "cache");
    mkdirSync(join(paths.runtime, "llama"), { recursive: true });
    writeFileSync(join(paths.runtime, "llama", "llama-server"), "bin");
    writeFileSync(join(paths.models, "weights.gguf"), "weights");
    await expect(privacy.deleteAll("nope", false)).rejects.toThrow(/delete everything/);
    const result = await privacy.deleteAll("delete everything", false);
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ quiesce: 1, afterReset: 1 });
    expect(result.removedPaths.some((path) => path.endsWith("apprentice.sqlite"))).toBe(true);
    expect(result.removedPaths.some((path) => path.endsWith("all-shot.enc"))).toBe(true);
    expect(result.removedPaths.some((path) => path.endsWith("master.key.enc"))).toBe(true);
    expect(existsSync(join(paths.exports, "bundle.zip"))).toBe(false);
    expect(existsSync(join(paths.modelCaches, "cache.bin"))).toBe(false);
    expect(existsSync(join(paths.runtime, "llama", "llama-server"))).toBe(true);
    expect(existsSync(join(paths.models, "weights.gguf"))).toBe(true);
    expect(context.storage.current.events.count()).toBe(0);
    expect(context.storage.current.screenshots.count()).toBe(0);
    expect(context.settings.get().installationId).not.toBe(before);
    expect(context.settings.get().onboardingCompleted).toBe(false);
    const again = await privacy.deleteAll("delete everything", true);
    expect(again.ok).toBe(true);
    expect(existsSync(join(paths.runtime, "llama", "llama-server"))).toBe(false);
    expect(existsSync(join(paths.models, "weights.gguf"))).toBe(false);
    expect(context.storage.current.productEvents.countByName("data_deleted")).toBe(1);
  });

  it("retention deletes old screenshots, OCR, and events but protects skill evidence", () => {
    const { context, privacy } = build();
    const storage = context.storage.current;
    const now = Date.now();
    const old = scenarioEvents("postMeetingFollowup", 1, "old", now - 40 * DAY);
    const fresh = scenarioEvents("postMeetingFollowup", 2, "fresh", now - HOUR);
    const evidence = scenarioEvents("invoiceProcessing", 1, "evidence", now - 45 * DAY);
    storage.events.insertMany([...old, ...fresh, ...evidence]);
    const episode: Episode = { id: "ep_evidence", sessionId: "evidence", startTs: evidence[0]!.ts, endTs: evidence[evidence.length - 1]!.ts, eventIds: evidence.map((event) => event.id), boundary: "inferred", boundaryReasons: ["session_edge"], apps: [], domains: [], actionTokens: [], meaningfulActionCount: 0, activeDurationMs: 0, privacyStatus: "clean", analysisStatus: "none", consumptionScore: 0 };
    storage.episodes.upsert(episode);
    storage.skills.save(skillFromDraft(demoSkillTemplates.invoiceProcessing as unknown as CoreSkillDraft, { source: "candidate", evidence: { episodeIds: ["ep_evidence"] }, mode: "guide" }));
    shot(context, "stale-shot", now - 30 * HOUR);
    shot(context, "fresh-shot", now - HOUR);
    storage.screenshots.insertOcr({ id: "ocr-old", screenshotId: "fresh-shot", ts: now - 8 * DAY, width: 1, height: 1, blocks: [] });
    const result = privacy.retentionRun();
    expect(result.deletedScreenshots).toBe(1);
    expect(result.deletedOcr).toBe(1);
    expect(storage.screenshots.ocrCount()).toBe(1);
    expect(result.deletedEvents).toBe(old.length);
    expect(storage.screenshots.get("stale-shot")).toBeNull();
    expect(storage.blobs.exists("stale-shot")).toBe(false);
    expect(storage.screenshots.get("fresh-shot")).not.toBeNull();
    expect(storage.events.query({ sessionId: "evidence", limit: 100 })).toHaveLength(evidence.length);
    expect(storage.events.query({ sessionId: "old", limit: 100 })).toHaveLength(0);
    expect(storage.events.query({ sessionId: "fresh", limit: 100 })).toHaveLength(fresh.length);
  });
});
