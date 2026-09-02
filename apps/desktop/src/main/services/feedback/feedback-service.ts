import { buildRemotePayload, createSafeZip, findForbiddenKeys, newId } from "@apprentice/core";
import { FeedbackSchema, type Feedback, type FeedbackAnswers, type HardwareInfo, type ModelStatus, type PerformanceMetrics, type RemoteFeedbackPayload } from "@apprentice/schemas";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { MetricsRecorder } from "@apprentice/core";
import type { Analytics } from "../analytics.js";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import { memoryBucket } from "../hardware.js";
import type { Logger } from "../logger.js";
import type { SettingsStore } from "../settings-store.js";
import { buildDiagnostics, buildRunTraceFile, preview } from "./diagnostics.js";
import { writeFeedbackBundle } from "./export-bundle.js";
import { pendingPulseDay, type PulseDay } from "./pulse.js";

const UPLOAD_TIMEOUT_MS = 10_000;

export interface FeedbackServiceDeps {
  readonly storage: StorageRef;
  readonly settings: SettingsStore;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: MetricsRecorder;
  readonly exportsDir: string;
  readonly appVersion: string;
  readonly hardware: () => Promise<HardwareInfo>;
  readonly modelStatus: () => Promise<Pick<ModelStatus, "providerType" | "model">>;
  readonly helperRestarts: () => number;
  readonly fetchImpl?: typeof fetch;
}

export interface SubmitInput {
  readonly contextType: Feedback["contextType"];
  readonly contextId: string;
  readonly answers: FeedbackAnswers;
  readonly comment?: string;
  /** The renderer shows the free-text warning before enabling the comment field. */
  readonly commentWarningShown?: boolean;
}

export interface ExportInput {
  readonly includeRunId?: string;
  readonly screenshotIds: readonly string[];
}

export interface ExportResult {
  readonly path: string;
  readonly byteLength: number;
  readonly fileCount: number;
  readonly includesScreenshots: boolean;
}

/** Local-first structured feedback: store, preview the strict payload, upload only with consent, export bundles. */
export class FeedbackService {
  constructor(private readonly deps: FeedbackServiceDeps) {}

  private performance(): PerformanceMetrics {
    const snapshot = this.deps.metrics.snapshot();
    const pick = (name: string): number | undefined => (snapshot[name] ? Math.round(snapshot[name].p50 * 100) / 100 : undefined);
    const queue = this.deps.metrics.counters();
    return {
      captureLatencyMs: pick("capture.captureMs"),
      encryptionLatencyMs: pick("capture.encryptMs"),
      queueDelayMs: pick("capture.queueDelayMs"),
      modelFirstResponseMs: pick("model.proposeMs"),
      stepLatencyMs: pick("run.stepMs"),
      peakQueueSize: queue["capture.enqueued"],
      helperRestarts: this.deps.helperRestarts()
    };
  }

  async submit(input: SubmitInput): Promise<Feedback> {
    const removedFields = findForbiddenKeys(input.answers);
    const answers = removedFields.length > 0 ? stripPaths(input.answers, removedFields) : input.answers;
    const settings = this.deps.settings.get();
    const model = await this.deps.modelStatus();
    const comment = input.comment !== undefined && input.comment.trim().length > 0 ? input.comment.trim() : undefined;
    const feedback = FeedbackSchema.parse({
      id: newId("fb"),
      contextType: input.contextType,
      contextId: input.contextId,
      answers,
      ...(comment !== undefined ? { comment } : {}),
      consent: { localStored: true, remoteUpload: settings.feedback.remoteConsent, commentWarningShown: comment !== undefined && (input.commentWarningShown ?? true) },
      sanitization: { ok: removedFields.length === 0, removedFields: removedFields.map((path) => path.slice(0, 64)) },
      uploadStatus: settings.feedback.remoteConsent ? "queued" : "local_only",
      appVersion: this.deps.appVersion,
      modelInfo: { provider: model.providerType, model: model.model },
      performance: this.performance(),
      createdAt: this.deps.clock.now()
    });
    this.deps.storage.current.feedback.save(feedback);
    this.deps.analytics.track("feedback_submitted", { contextType: input.contextType, hasComment: comment !== undefined, remote: settings.feedback.remoteConsent });
    return feedback;
  }

  list(): Feedback[] {
    return this.deps.storage.current.feedback.list();
  }

  async previewPayload(): Promise<{ payload: RemoteFeedbackPayload; removedFields: string[]; byteLength: number }> {
    const settings = this.deps.settings.get();
    const hardware = await this.deps.hardware();
    const model = await this.deps.modelStatus();
    const storage = this.deps.storage.current;
    const result = buildRemotePayload({
      feedback: storage.feedback.list().filter((item) => item.uploadStatus !== "uploaded").slice(0, 100),
      events: storage.productEvents.all().slice(-500),
      installationId: settings.installationId,
      participantCode: settings.feedback.participantCode,
      appVersion: this.deps.appVersion,
      macosMajor: Math.min(40, Math.max(14, hardware.macosMajor)),
      chipFamily: hardware.chipFamily,
      memoryBucket: memoryBucket(hardware.memoryGb),
      provider: model.providerType,
      model: model.model,
      performance: this.performance()
    });
    const byteLength = Buffer.byteLength(JSON.stringify(result.payload), "utf8");
    return { payload: result.payload, removedFields: [...result.removedFields], byteLength };
  }

  async upload(): Promise<{ ok: boolean; uploaded: number; message?: string }> {
    const settings = this.deps.settings.get();
    if (!settings.feedback.remoteConsent) return { ok: false, uploaded: 0, message: "Remote feedback is off; nothing was sent" };
    const endpointUrl = settings.feedback.endpointUrl?.trim();
    if (!endpointUrl) return { ok: false, uploaded: 0, message: "No feedback endpoint configured" };
    const storage = this.deps.storage.current;
    const pending = storage.feedback.list().filter((item) => item.uploadStatus === "queued" || item.uploadStatus === "local_only" || item.uploadStatus === "failed");
    const { payload } = await this.previewPayload();
    const fetchImpl = this.deps.fetchImpl ?? globalThis.fetch;
    try {
      const response = await fetchImpl(`${endpointUrl.replace(/\/+$/, "")}/v1/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
      });
      if (!response.ok) {
        storage.feedback.setStatus(pending.map((item) => item.id), "failed");
        return { ok: false, uploaded: 0, message: `Upload rejected with HTTP ${response.status}` };
      }
      storage.feedback.setStatus(pending.map((item) => item.id), "uploaded");
      this.deps.analytics.track("feedback_uploaded", { items: payload.feedback.length, events: payload.events.length });
      return { ok: true, uploaded: payload.feedback.length };
    } catch (error) {
      storage.feedback.setStatus(pending.map((item) => item.id), "failed");
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn("feedback upload failed", { message });
      return { ok: false, uploaded: 0, message: message.slice(0, 500) };
    }
  }

  private async diagnostics(): Promise<Record<string, unknown>> {
    return buildDiagnostics({
      appVersion: this.deps.appVersion,
      hardware: await this.deps.hardware(),
      model: await this.deps.modelStatus(),
      perf: this.deps.metrics.flat(),
      helperRestarts: this.deps.helperRestarts()
    });
  }

  async exportBundle(input: ExportInput): Promise<ExportResult> {
    const storage = this.deps.storage.current;
    const settings = this.deps.settings.get();
    let runTraceJson: string | undefined;
    if (input.includeRunId !== undefined) {
      const run = storage.runs.get(input.includeRunId);
      if (!run) throw new ServiceError("not_found", `Run ${input.includeRunId} not found`);
      runTraceJson = buildRunTraceFile(run, storage.runs.steps(run.id)).json;
    }
    const screenshots = input.screenshotIds.map((id) => {
      const png = storage.blobs.read(id);
      if (!png) throw new ServiceError("not_found", `Screenshot ${id} not found`);
      return { id, png };
    });
    const feedback = storage.feedback.list();
    const result = await writeFeedbackBundle({
      exportsDir: this.deps.exportsDir,
      installationId: settings.installationId,
      participantCode: settings.feedback.participantCode,
      appVersion: this.deps.appVersion,
      createdAt: this.deps.clock.now(),
      events: storage.productEvents.all(),
      feedback,
      diagnostics: await this.diagnostics(),
      runTraceJson,
      screenshots
    });
    storage.feedback.setStatus(feedback.filter((item) => item.uploadStatus === "local_only" || item.uploadStatus === "queued").map((item) => item.id), "exported");
    this.deps.analytics.track("export_created", { fileCount: result.fileCount, includesScreenshots: result.includesScreenshots, kind: "feedback_bundle" });
    return { path: result.path, byteLength: statSync(result.path).size, fileCount: result.fileCount, includesScreenshots: result.includesScreenshots };
  }

  pendingPulse(): PulseDay | null {
    const settings = this.deps.settings.get();
    const day = pendingPulseDay(settings.feedback, this.deps.clock.now());
    if (day !== null) this.deps.settings.update({ feedback: { ...settings.feedback, lastPulsePromptTs: this.deps.clock.now() } });
    return day;
  }

  dismissPulse(day: PulseDay): void {
    const feedback = this.deps.settings.get().feedback;
    if (feedback.pulseShown.includes(day)) return;
    this.deps.settings.update({ feedback: { ...feedback, pulseShown: [...feedback.pulseShown, day] } });
  }

  async previewDiagnostics(runId: string): Promise<{ files: Array<{ name: string; byteLength: number; preview: string }>; redactedFields: string[] }> {
    const storage = this.deps.storage.current;
    const run = storage.runs.get(runId);
    if (!run) throw new ServiceError("not_found", `Run ${runId} not found`);
    const trace = buildRunTraceFile(run, storage.runs.steps(runId));
    const diagnostics = JSON.stringify(await this.diagnostics(), null, 2);
    return {
      files: [
        { name: "run-trace.json", byteLength: Buffer.byteLength(trace.json), preview: preview(trace.json) },
        { name: "diagnostics.json", byteLength: Buffer.byteLength(diagnostics), preview: preview(diagnostics) }
      ],
      redactedFields: [...trace.redactedFields]
    };
  }

  async exportDiagnostics(runId: string): Promise<ExportResult> {
    const storage = this.deps.storage.current;
    const run = storage.runs.get(runId);
    if (!run) throw new ServiceError("not_found", `Run ${runId} not found`);
    const trace = buildRunTraceFile(run, storage.runs.steps(runId));
    const diagnostics = JSON.stringify(await this.diagnostics(), null, 2);
    const path = join(this.deps.exportsDir, `${runId.replace(/[^A-Za-z0-9_-]/g, "_")}-diagnostics.zip`);
    const written = await createSafeZip(
      [
        { name: "run-trace.json", data: Buffer.from(trace.json) },
        { name: "diagnostics.json", data: Buffer.from(diagnostics) }
      ],
      path
    );
    this.deps.analytics.track("export_created", { fileCount: written.fileCount, includesScreenshots: false, kind: "run_diagnostics" });
    return { path, byteLength: statSync(path).size, fileCount: written.fileCount, includesScreenshots: false };
  }
}

function stripPaths<T>(value: T, paths: readonly string[]): T {
  const roots = new Set(paths.map((path) => path.split(".")[0]?.replace(/\[\d+\]$/, "") ?? path));
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !roots.has(key))) as T;
}
