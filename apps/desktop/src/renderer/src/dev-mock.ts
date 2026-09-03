/**
 * Mock window.apprentice bridge for previews outside Electron. Only imported
 * when import.meta.env.DEV is true and no bridge exists, so production
 * bundles never include it.
 */
import type { ApprovalRequest, RunDetail } from "@apprentice/schemas";
import { IPC_CHANNELS, IPC_EVENT_NAMES } from "@apprentice/schemas";
import {
  NOW,
  TINY_PNG,
  sampleCandidates,
  sampleEpisodes,
  sampleEvents,
  sampleFeedback,
  sampleFinishedRun,
  sampleModel,
  sampleRun,
  sampleScreenshots,
  sampleSettings,
  sampleSkill,
  sampleSkillV1,
  sampleSteps
} from "./dev-mock/samples";

type Listener = (payload: unknown) => void;

function deepMerge<T extends object>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      out[key] = deepMerge(current as object, value as object);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export function installDevMock(): void {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, payload: unknown): void => {
    listeners.get(event)?.forEach((l) => l(payload));
  };
  let settings = sampleSettings;
  let learning = { state: settings.learning.state, menuBarStatus: "learning" as const };
  let model = sampleModel;
  const runDetail: RunDetail = {
    run: sampleRun,
    steps: sampleSteps,
    pendingApproval: null,
    pendingQuestion: null
  };
  const approval: ApprovalRequest = {
    runId: "run-1",
    stepId: "step-2",
    stepIndex: 1,
    subtaskIndex: 1,
    subtaskTitle: "Draft the email",
    proposed: sampleSteps[1]?.proposed ?? { type: "wait", ms: 500, purpose: "wait", expectedResult: "wait", confidence: 0.5, sourceScreenshot: { width: 1, height: 1 }, subtaskIndex: 0 },
    risk: sampleSteps[1]?.risk ?? { riskClass: "unknown", decision: "approve", reasons: [], matchedTerms: [], coveredByRunApproval: false },
    screenshotPngBase64: TINY_PNG,
    screenshotWidth: 1440,
    screenshotHeight: 900,
    target: { x: 640, y: 120, label: "Subject field" },
    actionSummary: "Type the subject line",
    rationale: "The subject field is empty and focused.",
    canApproveRunLowRisk: true,
    requestedAt: NOW
  };
  runDetail.pendingApproval = approval;

  const handlers: Record<string, (payload: unknown) => unknown> = {
    "app:version": () => ({ version: "0.1.0-alpha.1 (preview)", productName: "Apprentice" }),
    "app:overview": () => ({
      learningState: learning.state,
      menuBarStatus: learning.menuBarStatus,
      modelStatus: model,
      hoursObserved: 5.4,
      candidateCount: 1,
      skillCount: 1,
      estimatedWeeklyMinutes: 40,
      recentCandidate: sampleCandidates[0] ?? null,
      recentRun: sampleRun,
      permissions: { accessibility: "granted", screenRecording: "denied", helperAvailable: true },
      demoMode: settings.demoMode,
      helperConnected: true,
      extensionPaired: false,
      pendingPulseDay: 1
    }),
    "app:hardware": () => ({ chip: "Apple M2 Pro", chipFamily: "m2", arch: "arm64", memoryGb: 32, freeDiskGb: 210, macosVersion: "15.4", macosMajor: 15, recommendedExperience: "full_local_model", isAppleSilicon: true }),
    "app:openDataFolder": () => ({ ok: true }),
    "app:openExternal": () => ({ ok: true }),
    "app:revealPath": () => ({ ok: true }),
    "settings:get": () => settings,
    "settings:update": (p) => {
      settings = deepMerge(settings, p as Partial<typeof settings>);
      return settings;
    },
    "settings:completeOnboarding": () => {
      settings = { ...settings, onboardingCompleted: true, onboardingStep: 7 };
      return settings;
    },
    "permissions:status": () => ({ accessibility: "granted", screenRecording: "not_determined", helperAvailable: true }),
    "permissions:request": () => ({ accessibility: "granted", screenRecording: "granted", helperAvailable: true }),
    "permissions:openSettings": () => ({ ok: true }),
    "learning:setState": (p) => {
      const { state } = p as { state: typeof learning.state };
      learning = { state, menuBarStatus: state === "learning" ? "learning" : state === "paused" ? "paused" : state === "private" ? "private" : "stopped" } as typeof learning;
      emit("event:learning", learning);
      return learning;
    },
    "learning:status": () => learning,
    "activity:list": () => ({ events: sampleEvents, screenshots: sampleScreenshots }),
    "activity:deleteEvents": (p) => ({ deleted: (p as { eventIds: string[] }).eventIds.length }),
    "activity:deleteRange": () => ({ deleted: 3 }),
    "activity:deleteScreenshots": (p) => ({ deleted: (p as { screenshotIds: string[] }).screenshotIds.length }),
    "screenshot:get": () => ({ pngBase64: TINY_PNG, width: 1440, height: 900 }),
    "episodes:list": () => sampleEpisodes,
    "episodes:resegment": () => ({ episodes: 2, candidates: 1 }),
    "teach:openRange": (p) => {
      const minutes = (p as { minutes?: number }).minutes ?? 15;
      return { startTs: NOW - minutes * 60_000, endTs: NOW, events: sampleEvents, screenshots: sampleScreenshots };
    },
    "teach:draft": () => ({
      draft: { name: "Meeting follow-up email", description: "", goal: "Draft a follow-up email", trigger: "After a meeting note is opened", subtasks: sampleSkill.subtasks.map(({ title, goal, completionCriteria, keySteps, appOrDomain }) => ({ title, goal, completionCriteria, keySteps, appOrDomain })), variables: sampleSkill.variables, successCriteria: sampleSkill.successCriteria, riskNotes: ["Involves a mail client"], allowedApps: sampleSkill.allowedApps, allowedDomains: sampleSkill.allowedDomains, origin: "deterministic", confidence: 0.6 },
      retained: { eventCount: 9, screenshotCount: 2, fields: ["event type", "app name", "domain", "route pattern", "element role", "element label", "timestamps"] }
    }),
    "teach:save": () => sampleSkill,
    "candidates:list": (p) => ((p as { includeSuppressed?: boolean }).includeSuppressed ? sampleCandidates : sampleCandidates.filter((c) => c.suppression.state === "active")),
    "candidates:get": (p) => ({ candidate: sampleCandidates.find((c) => c.id === (p as { id: string }).id) ?? sampleCandidates[0], evidence: sampleEpisodes.map((episode) => ({ episode, events: sampleEvents.filter((e) => episode.eventIds.includes(e.id)) })) }),
    "candidates:act": (p) => {
      const { action } = p as { action: string };
      const candidate = sampleCandidates[0];
      if (action === "try_once") return { candidate, skill: sampleSkill, run: sampleRun };
      if (action === "edit_and_save") return { candidate, skill: sampleSkill, run: null };
      return { candidate: { ...candidate, suppression: { state: action === "private_workflow" ? "private" : action } }, skill: null, run: null };
    },
    "candidates:draft": () => handlers["teach:draft"]?.(null),
    "skills:list": () => [sampleSkill],
    "skills:get": () => ({ skill: sampleSkill, history: [sampleSkillV1] }),
    "skills:save": (p) => ({ ...(p as { skill: typeof sampleSkill }).skill, version: sampleSkill.version + 1, updatedAt: Date.now() }),
    "skills:delete": () => ({ deleted: true }),
    "runs:start": () => sampleRun,
    "runs:list": () => [sampleRun, sampleFinishedRun],
    "runs:get": (p) => ((p as { id: string }).id === "run-0" ? { run: sampleFinishedRun, steps: sampleSteps, pendingApproval: null, pendingQuestion: null } : runDetail),
    "runs:approve": () => ({ ...runDetail, pendingApproval: null, run: { ...sampleRun, status: "running" } }),
    "runs:answer": () => runDetail,
    "runs:advanceSubtask": () => ({ ...runDetail, pendingApproval: null, pendingQuestion: null, run: { ...sampleRun, status: "running", currentSubtaskIndex: Math.min(sampleRun.currentSubtaskIndex + 1, sampleRun.subtaskCount - 1) } }),
    "runs:stop": () => ({ ...runDetail, pendingApproval: null, run: { ...sampleRun, status: "interrupted", interruptedBy: "ui_stop", endedAt: Date.now() } }),
    "runs:exportDiagnostics": () => ({ path: "/tmp/run-1-diagnostics.zip", byteLength: 14_000, fileCount: 3, includesScreenshots: false }),
    "runs:previewDiagnostics": () => ({ files: [{ name: "run.json", byteLength: 4000, preview: JSON.stringify({ id: "run-1", status: "interrupted" }, null, 2) }, { name: "steps.json", byteLength: 9000, preview: "[...]" }], redactedFields: ["typedText", "ocr", "screenshot", "windowTitle"] }),
    "feedback:submit": (p) => ({ ...sampleFeedback[0], id: `fb-${Date.now()}`, ...(p as object), consent: { localStored: true, remoteUpload: false, commentWarningShown: false }, sanitization: { ok: true, removedFields: [] }, uploadStatus: "local_only", appVersion: "0.1.0", modelInfo: { provider: "mock" }, performance: {}, createdAt: Date.now() }),
    "feedback:list": () => sampleFeedback,
    "feedback:previewPayload": () => ({ payload: { schemaVersion: "1.0", installationId: settings.installationId, appVersion: "0.1.0-alpha.1", macosMajor: 15, chipFamily: "m2", memoryBucket: "32", provider: "mock", events: [{ name: "candidate_viewed", ts: NOW, counts: { count: 3 } }], feedback: sampleFeedback.map((f) => ({ contextType: f.contextType, answers: f.answers, createdAt: f.createdAt })) }, removedFields: ["comment.email", "title"], byteLength: 640 }),
    "feedback:upload": () => ({ ok: true, uploaded: 1 }),
    "feedback:export": (p) => ({ path: "/tmp/feedback.apprentice-feedback.zip", byteLength: 20_000, fileCount: 4, includesScreenshots: ((p as { screenshotIds?: string[] }).screenshotIds ?? []).length > 0 }),
    "feedback:dismissPulse": () => ({ ok: true }),
    "privacy:stats": () => ({ eventCount: 1240, screenshotCount: 86, ocrCount: 60, episodeCount: 14, candidateCount: 2, skillCount: 1, runCount: 2, feedbackCount: 1, storedBytes: 48_000_000, screenshotBytes: 40_000_000, databaseBytes: 8_000_000, dataDirectory: "/Users/you/Library/Application Support/Apprentice", activeExclusions: ["1password.com", "com.apple.Passwords", "accounts.google.com"], queuedUploads: 0 }),
    "privacy:deleteToday": () => ({ deletedEvents: 120, deletedScreenshots: 9 }),
    "privacy:deleteSkillData": () => ({ ok: true }),
    "privacy:deleteAll": () => ({ ok: true, removedPaths: ["/Users/you/Library/Application Support/Apprentice"] }),
    "privacy:retentionRun": () => ({ deletedScreenshots: 4, deletedOcr: 2, deletedEvents: 0 }),
    "model:status": () => model,
    "model:testConnection": (p) => ({ ok: true, provider: "openai_compatible", model: (p as { model: string }).model, endpoint: (p as { baseUrl: string }).baseUrl, latencyMs: 340, capabilities: { vision: true, actionPolicy: false, structuredOutput: true }, checkedAt: Date.now() }),
    "model:configure": (p) => {
      const { providerType, endpoint } = p as { providerType: typeof model.providerType; endpoint?: { model: string } };
      model = { ...model, providerType, model: endpoint?.model ?? model.model, location: providerType === "mock" ? "none" : providerType === "uimate" ? "local_managed" : "local_external" };
      emit("event:model", model);
      return model;
    },
    "model:runtime": (p) => {
      const { action } = p as { action: string };
      if (action === "installRuntime") model = { ...model, runtime: { ...model.runtime, runtimeInstalled: true, runtimeVersion: "b4500" } };
      if (action === "installModel") model = { ...model, runtime: { ...model.runtime, modelInstalled: true, download: { active: false, receivedBytes: 5_000_000_000, totalBytes: 5_000_000_000 } } };
      if (action === "start" || action === "restart") model = { ...model, runtime: { ...model.runtime, processState: "running", port: 8080, pid: 4242 } };
      if (action === "stop") model = { ...model, runtime: { ...model.runtime, processState: "stopped" } };
      emit("event:model", model);
      return model;
    },
    "model:runtimeInfo": () => ({ runtimeRelease: "llama.cpp b4500", runtimeSha256: "aa11".repeat(16), modelRepo: "Tencent/UI-Mate-9B-GGUF", modelQuant: "Q4_K_M", modelFile: "ui-mate-9b-q4_k_m.gguf", modelSha256: "bb22".repeat(16), mmprojFile: "mmproj-ui-mate-9b-f16.gguf", mmprojSha256: "cc33".repeat(16), expectedBytes: 6_100_000_000, license: "Apache-2.0", sourceUrl: "https://huggingface.co/Tencent/UI-Mate-9B", runtimeUrl: "https://github.com/ggml-org/llama.cpp/releases" }),
    "model:stopAll": () => {
      model = { ...model, paused: true, pauseReason: "Stopped by user", queue: { ...model.queue, pending: 0, active: 0 } };
      emit("event:model", model);
      return model;
    },
    "demo:load": (p) => ({ loaded: true, daysSimulated: (p as { days?: number }).days ?? 3, scenario: ["post_meeting_followup"] }),
    "demo:reset": () => ({ loaded: false, daysSimulated: 0, scenario: [] }),
    "demo:status": () => ({ loaded: true, daysSimulated: 3, scenario: ["post_meeting_followup", "invoice_processing"] }),
    "extension:status": () => ({ paired: false, eventsReceived: 0, port: 47815 }),
    "extension:pairingCode": () => ({ code: "482913", expiresAt: Date.now() + 5 * 60_000, port: 47815 }),
    "extension:unpair": () => ({ paired: false, eventsReceived: 0 }),
    "analytics:track": () => ({ ok: true }),
    "analytics:list": () => [],
    "perf:metrics": () => ({ captureLatencyMs: 80 })
  };

  window.apprentice = {
    channels: IPC_CHANNELS,
    events: IPC_EVENT_NAMES,
    async invoke(channel: string, payload?: unknown): Promise<unknown> {
      await new Promise((r) => window.setTimeout(r, 120));
      const handler = handlers[channel];
      if (!handler) return { ok: false, error: { code: "unimplemented", message: `Mock has no handler for ${channel}` } };
      return { ok: true, data: handler(payload) };
    },
    on(event: string, listener: Listener): () => void {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return () => {
        set.delete(listener);
      };
    }
  };
  window.setTimeout(() => emit("event:toast", { kind: "info", message: "Preview mode: mock data, nothing is captured." }), 800);
}
