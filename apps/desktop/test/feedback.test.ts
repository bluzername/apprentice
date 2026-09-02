import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readZipEntries } from "@apprentice/core";
import { FeedbackBundleManifestSchema, RemoteFeedbackPayloadSchema, type FeedbackAnswers, type HardwareInfo, type Run } from "@apprentice/schemas";
import { createManualClock, systemClock } from "../src/main/services/clock.js";
import { FeedbackService } from "../src/main/services/feedback/feedback-service.js";
import { silentLogger } from "../src/main/services/logger.js";
import { REPO_ROOT, fixtures, makeContext, tempDir } from "./helpers.js";

const execFileAsync = promisify(execFile);
const HARDWARE: HardwareInfo = { chip: "Apple M3", chipFamily: "m3", arch: "arm64", memoryGb: 24, freeDiskGb: 100, macosVersion: "26.0", macosMajor: 26, recommendedExperience: "full_local_model", isAppleSilicon: true };

function service(clock = systemClock) {
  const context = makeContext();
  const feedback = new FeedbackService({ storage: context.storage, settings: context.settings, analytics: context.analytics, clock, logger: silentLogger, metrics: context.metrics, exportsDir: context.paths.exports, appVersion: "0.1.0-test", hardware: async () => HARDWARE, modelStatus: async () => ({ providerType: "mock", model: "mock" }), helperRestarts: () => 0 });
  return { context, feedback };
}

const candidateAnswers: FeedbackAnswers = { kind: "candidate", relevant: true, wouldDelegate: "yes", boundaryAccuracy: "correct", reasonCodes: [] };

function sampleRun(skillId: string): Run {
  return { id: "run_fb", skillId, skillVersion: 1, skillName: "Sample", mode: "guide", status: "completed", currentSubtaskIndex: 0, subtaskCount: 1, startedAt: 1, endedAt: 2, failureCategory: "none", provider: "mock", metrics: { steps: 1, approvedActions: 1, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 0, modelLatencyMsMax: 0, screenshotsUsed: 1 }, lowRiskRunApproval: false, navigationRunApproval: false, summary: "Typed the secret" };
}

describe("feedback service", () => {
  it("submits, lists, strips forbidden fields, and keeps comments only after the warning", async () => {
    const { context, feedback } = service();
    const tainted = { ...candidateAnswers, screenshot: "data:image/png;base64,AAAA" } as unknown as FeedbackAnswers;
    const first = await feedback.submit({ contextType: "candidate", contextId: "cand_1", answers: tainted, comment: "  Works well  ", commentWarningShown: true });
    expect(first.sanitization.removedFields).toEqual(["screenshot"]);
    expect(JSON.stringify(first.answers)).not.toContain("data:image");
    expect(first.comment).toBe("Works well");
    expect(first.consent.commentWarningShown).toBe(true);
    expect(first.uploadStatus).toBe("local_only");
    const second = await feedback.submit({ contextType: "general", contextId: "app", answers: { kind: "general", sentiment: "neutral" }, comment: "Unwarned comment", commentWarningShown: false });
    expect(second.consent.commentWarningShown).toBe(false);
    expect(feedback.list()).toHaveLength(2);
    const preview = await feedback.previewPayload();
    expect(RemoteFeedbackPayloadSchema.safeParse(preview.payload).success).toBe(true);
    expect(preview.payload.feedback.find((item) => item.contextType === "candidate")?.comment).toBe("Works well");
    expect(preview.payload.feedback.find((item) => item.contextType === "general")?.comment).toBeUndefined();
    expect(preview.removedFields.some((field) => field.endsWith(".comment"))).toBe(true);
    expect(preview.byteLength).toBeGreaterThan(50);
    expect(JSON.stringify(preview.payload)).not.toMatch(/title|screenshot|ocr/i);
    expect(context.storage.current.productEvents.countByName("feedback_submitted")).toBe(2);
  });

  it("exports the documented bundle layout that the aggregator can read", async () => {
    const { context, feedback } = service();
    await feedback.submit({ contextType: "run", contextId: "run_fb", answers: { kind: "run", outcomeAchieved: "yes", corrections: 1, estimatedTimeSavedMinutes: 10, trustRating: 5, wouldUseAgain: true, failureCategory: "none" }, comment: "Great", commentWarningShown: true });
    const storage = context.storage.current;
    storage.runs.save(sampleRun("skill_x"));
    storage.runs.saveStep({ id: "step_1", runId: "run_fb", index: 0, subtaskIndex: 0, ts: 1, proposed: { type: "type_text", text: "the secret", purpose: "p", expectedResult: "e", confidence: 0.9, sourceScreenshot: { width: 10, height: 10 }, subtaskIndex: 0 }, actionSummary: "type", rationale: "", validation: null, risk: null, approval: null, executed: { type: "type_text", text: "the secret" }, verification: null, timing: { captureMs: 0, proposeMs: 0, approvalWaitMs: 0, executeMs: 0, verifyMs: 0, totalMs: 0 }, failureCategory: "none", userInterrupted: false });
    const png = fixtures.readScreenshotPng("genericBlank");
    const written = storage.blobs.write("shot_fb", png);
    storage.screenshots.insert({ id: "shot_fb", ts: 1, sessionId: "s", width: 1440, height: 900, displayScale: 1, perceptualHash: "0000000000000000", byteLength: written.byteLength, reason: "demo", analyzed: true });
    const result = await feedback.exportBundle({ includeRunId: "run_fb", screenshotIds: ["shot_fb"] });
    expect(existsSync(result.path)).toBe(true);
    expect(result.path.endsWith(".apprentice-feedback.zip")).toBe(true);
    expect(result.includesScreenshots).toBe(true);
    const entries = await readZipEntries(result.path);
    expect(entries.map((entry) => entry.name)).toEqual(["manifest.json", "product-events.jsonl", "feedback.json", "diagnostics.json", "run-trace.json", "screenshots/shot_fb.png"]);
    const manifest = FeedbackBundleManifestSchema.parse(JSON.parse(entries[0]!.data.toString("utf8")));
    expect(manifest.files).toEqual(entries.map((entry) => entry.name));
    expect(manifest.screenshotCount).toBe(1);
    const events = entries[1]!.data.toString("utf8").trim().split("\n");
    expect(events.length).toBeGreaterThan(0);
    for (const line of events) expect(typeof JSON.parse(line).name).toBe("string");
    const trace = entries[4]!.data.toString("utf8");
    expect(trace).not.toContain("the secret");
    expect(trace).toContain("[redacted len=10]");
    const diagnostics = JSON.parse(entries[3]!.data.toString("utf8")) as Record<string, unknown>;
    expect(diagnostics).toMatchObject({ appVersion: "0.1.0-test", macosMajor: 26, chipFamily: "m3", memoryBucket: "24", provider: "mock" });
    expect(feedback.list()[0]?.uploadStatus).toBe("exported");
    const bundlesDir = tempDir("bundles-");
    copyFileSync(result.path, join(bundlesDir, "one.apprentice-feedback.zip"));
    const outDir = join(bundlesDir, "aggregate");
    mkdirSync(outDir);
    await execFileAsync(process.execPath, [join(REPO_ROOT, "scripts", "aggregate-feedback.mjs"), bundlesDir, outDir], { cwd: REPO_ROOT, timeout: 60_000 });
    expect(existsSync(join(outDir, "feedback-summary.csv"))).toBe(true);
    expect(existsSync(join(outDir, "feedback-report.html"))).toBe(true);
    const preview = await feedback.previewDiagnostics("run_fb");
    expect(preview.files.map((file) => file.name)).toEqual(["run-trace.json", "diagnostics.json"]);
    expect(preview.redactedFields).toContain("steps[].proposed.text");
    const diag = await feedback.exportDiagnostics("run_fb");
    expect(diag.path.endsWith("run_fb-diagnostics.zip")).toBe(true);
    expect((await readZipEntries(diag.path)).map((entry) => entry.name)).toEqual(["run-trace.json", "diagnostics.json"]);
  }, 60_000);

  it("uploads only the strict payload, only with consent", async () => {
    const { context, feedback } = service();
    await feedback.submit({ contextType: "pulse", contextId: "day1", answers: { kind: "pulse", day: 1, stillUsing: true, mostUseful: "candidates", biggestConcern: "none", recommendScore: 9 } });
    const requests: Array<{ url: string; body: unknown }> = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, duplicate: false, id: "1" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    expect(await feedback.upload()).toMatchObject({ ok: false, uploaded: 0 });
    expect(requests).toHaveLength(0);
    context.settings.update({ feedback: { ...context.settings.get().feedback, remoteConsent: true, endpointUrl: `http://127.0.0.1:${port}` } });
    const result = await feedback.upload();
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/v1/feedback");
    expect(RemoteFeedbackPayloadSchema.strict().safeParse(requests[0]?.body).success).toBe(true);
    expect(feedback.list()[0]?.uploadStatus).toBe("uploaded");
    server.close();
  });

  it("offers day 1/3/7 pulses at most once per calendar day", () => {
    const clock = createManualClock(Date.UTC(2026, 8, 1, 12));
    const { context, feedback } = service(clock);
    context.settings.update({ feedback: { ...context.settings.get().feedback, firstRunTs: clock.now() } });
    expect(feedback.pendingPulse()).toBeNull();
    clock.advance(3 * 24 * 60 * 60 * 1000);
    expect(feedback.pendingPulse()).toBe(1);
    expect(feedback.pendingPulse()).toBeNull();
    feedback.dismissPulse(1);
    clock.advance(24 * 60 * 60 * 1000);
    expect(feedback.pendingPulse()).toBe(3);
    feedback.dismissPulse(3);
    clock.advance(24 * 60 * 60 * 1000);
    expect(feedback.pendingPulse()).toBeNull();
    clock.advance(3 * 24 * 60 * 60 * 1000);
    expect(feedback.pendingPulse()).toBe(7);
  });
});
