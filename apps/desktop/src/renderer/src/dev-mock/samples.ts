import type {
  ActivityEvent,
  AppSettings,
  Episode,
  Feedback,
  ModelStatus,
  Run,
  RunStep,
  ScreenshotRecord,
  Skill,
  WorkflowCandidate
} from "@apprentice/schemas";

export const NOW = Date.now();
const MIN = 60_000;

export const sampleSettings: AppSettings = {
  schemaVersion: 1,
  installationId: "0123456789abcdef0123456789abcdef",
  onboardingCompleted: true,
  onboardingStep: 7,
  demoMode: true,
  allowlist: { apps: [{ bundleId: "com.google.Chrome", name: "Google Chrome" }, { bundleId: "com.apple.mail", name: "Mail" }], domains: ["notion.so", "linear.app"] },
  learning: { state: "learning" },
  retention: { screenshotHours: 24, ocrDays: 7, eventsDays: 30 },
  model: { providerType: "mock", managedRuntime: false, onlyOnPower: false, onlyWhenIdle: false },
  feedback: { remoteConsent: false, pulseShown: [], firstRunTs: NOW - 3 * 24 * 60 * MIN },
  shortcuts: { teach: "Alt+Command+L" },
  experimental: { lowRiskAuto: false },
  appearance: "system",
  captureViaHelper: false
};

export const sampleModel: ModelStatus = {
  providerType: "mock",
  model: "mock-vision-1",
  location: "none",
  health: { ok: true, provider: "mock", model: "mock-vision-1", latencyMs: 12, capabilities: { vision: true, actionPolicy: true, structuredOutput: true }, checkedAt: NOW - MIN },
  memoryRecommendation: "16 GB unified memory is enough for the light local model.",
  runtime: { runtimeInstalled: false, modelInstalled: false, processState: "stopped" },
  queue: { pending: 0, active: 0, peak: 2 },
  lastLatencyMs: 12,
  screenshotsUsed: 4,
  paused: false
};

function event(i: number, type: ActivityEvent["type"], extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: `ev-${i}`,
    ts: NOW - (14 - i) * MIN,
    seq: i,
    sessionId: "session-1",
    source: "native_helper",
    type,
    privacy: "allowed",
    redaction: "none_needed",
    app: { bundleId: "com.google.Chrome", name: "Google Chrome" },
    ...extra
  };
}

export const sampleEvents: ActivityEvent[] = [
  event(1, "session_start"),
  event(2, "app_activated"),
  event(3, "navigation", { domain: "notion.so", routePattern: "/meeting-notes/:id", screenshotRef: "shot-1" }),
  event(4, "click", { domain: "notion.so", element: { role: "button", name: "Share" } }),
  event(5, "copy", { domain: "notion.so" }),
  event(6, "app_activated", { app: { bundleId: "com.apple.mail", name: "Mail" }, screenshotRef: "shot-2" }),
  event(7, "shortcut", { app: { bundleId: "com.apple.mail", name: "Mail" }, payload: { keys: ["command", "n"] } }),
  event(8, "paste", { app: { bundleId: "com.apple.mail", name: "Mail" } }),
  event(9, "privacy_gap", { privacy: "privacy_gap", app: undefined, payload: { reason: "app_outside_allowlist" } }),
  event(10, "app_activated", { domain: "linear.app", screenshotRef: "shot-3" }),
  event(11, "form_submit", { domain: "linear.app", payload: { formPurpose: "create" } }),
  event(12, "idle_changed", { payload: { idle: true } })
];

export const sampleScreenshots: ScreenshotRecord[] = [
  { id: "shot-1", ts: sampleEvents[2]?.ts ?? NOW, sessionId: "session-1", eventId: "ev-3", width: 1440, height: 900, displayScale: 2, perceptualHash: "abc", byteLength: 120_000, reason: "navigation", analyzed: false, domain: "notion.so" },
  { id: "shot-2", ts: sampleEvents[5]?.ts ?? NOW, sessionId: "session-1", eventId: "ev-6", width: 1440, height: 900, displayScale: 2, perceptualHash: "abd", byteLength: 118_000, reason: "app_change", analyzed: false },
  { id: "shot-3", ts: sampleEvents[9]?.ts ?? NOW, sessionId: "session-1", eventId: "ev-10", width: 1440, height: 900, displayScale: 2, perceptualHash: "abe", byteLength: 121_000, reason: "app_change", analyzed: false, domain: "linear.app" }
];

export const sampleEpisodes: Episode[] = [
  {
    id: "ep-1",
    sessionId: "session-1",
    startTs: NOW - 13 * MIN,
    endTs: NOW - 6 * MIN,
    eventIds: ["ev-1", "ev-2", "ev-3", "ev-4", "ev-5", "ev-6", "ev-7", "ev-8"],
    boundary: "inferred",
    boundaryReasons: ["context_shift", "outcome_event"],
    apps: ["Google Chrome", "Mail"],
    domains: ["notion.so"],
    actionTokens: ["nav:notion.so/meeting-notes", "click:Share", "copy", "app:Mail", "shortcut:cmd+n", "paste"],
    meaningfulActionCount: 6,
    triggerHypothesis: "After opening a meeting note in Notion",
    outcomeHypothesis: "A follow-up email draft exists in Mail",
    activeDurationMs: 7 * MIN,
    privacyStatus: "clean",
    analysisStatus: "analyzed",
    consumptionScore: 0.05
  },
  {
    id: "ep-2",
    sessionId: "session-1",
    startTs: NOW - 4 * MIN,
    endTs: NOW - 2 * MIN,
    eventIds: ["ev-10", "ev-11"],
    boundary: "inferred",
    boundaryReasons: ["idle_gap"],
    apps: ["Google Chrome"],
    domains: ["linear.app"],
    actionTokens: ["app:linear.app", "submit:create"],
    meaningfulActionCount: 2,
    activeDurationMs: 2 * MIN,
    privacyStatus: "contains_gaps",
    analysisStatus: "none",
    consumptionScore: 0.1
  }
];

export const sampleCandidates: WorkflowCandidate[] = [
  {
    id: "cand-1",
    source: "passive",
    evidenceEpisodeIds: ["ep-1", "ep-1"],
    similarity: { meanPairwise: 0.86, minPairwise: 0.8, weightedLcs: 0.9, editSimilarity: 0.84, appTransitionSimilarity: 0.95, durationConsistency: 0.7 },
    repeatCount: 3,
    medianDurationMs: 7 * MIN,
    estimatedWeeklyFrequency: 4,
    estimatedWeeklyMinutes: 28,
    deterministicTitle: "Notion meeting note to Mail follow-up",
    refinedTitle: "Send a follow-up email after a meeting note",
    refinedDescription: "Open the latest meeting note in Notion, copy the action items and draft a follow-up email in Mail.",
    trigger: "After a calendar meeting ends and the Notion note is opened",
    steps: [
      { index: 0, description: "Open the meeting note in Notion", token: "nav:notion.so/meeting-notes", appOrDomain: "notion.so", occurrenceRatio: 1 },
      { index: 1, description: "Copy the action items section", token: "copy", appOrDomain: "notion.so", occurrenceRatio: 1 },
      { index: 2, description: "Switch to Mail and create a new message", token: "shortcut:cmd+n", appOrDomain: "Mail", occurrenceRatio: 1 },
      { index: 3, description: "Paste the action items into the draft", token: "paste", appOrDomain: "Mail", occurrenceRatio: 0.67 }
    ],
    variables: [
      { name: "meeting_title", kind: "text", description: "Title of the meeting note", examples: ["Weekly sync", "Design review"], required: true },
      { name: "recipient", kind: "person", description: "Who receives the follow-up", examples: [], required: true }
    ],
    expectedOutcome: "A follow-up email draft with the action items exists in Mail",
    confidence: 0.78,
    confidenceExplanation: "I observed a similar sequence 3 times over 3 days. The apps and order matched in every case; the paste step appeared in 2 of 3.",
    scoreComponents: { sequenceSimilarity: 0.86, repeatCount: 0.6, triggerConsistency: 0.8, outcomeConsistency: 0.75, timeCost: 0.5, lowRiskCoverage: 0.6 },
    riskClass: "external_communication",
    suppression: { state: "active" },
    apps: ["Google Chrome", "Mail"],
    domains: ["notion.so"],
    createdAt: NOW - 2 * 60 * MIN,
    updatedAt: NOW - 60 * MIN,
    patternKey: "pk-1"
  },
  {
    id: "cand-2",
    source: "passive",
    evidenceEpisodeIds: ["ep-2", "ep-2"],
    similarity: { meanPairwise: 0.7, minPairwise: 0.65, weightedLcs: 0.7, editSimilarity: 0.7, appTransitionSimilarity: 0.8, durationConsistency: 0.9 },
    repeatCount: 2,
    medianDurationMs: 2 * MIN,
    estimatedWeeklyFrequency: 6,
    estimatedWeeklyMinutes: 12,
    deterministicTitle: "Create a Linear issue from Chrome",
    trigger: "After reading a bug report",
    steps: [
      { index: 0, description: "Open Linear", token: "app:linear.app", appOrDomain: "linear.app", occurrenceRatio: 1 },
      { index: 1, description: "Submit the new issue form", token: "submit:create", appOrDomain: "linear.app", occurrenceRatio: 1 }
    ],
    variables: [],
    expectedOutcome: "A new Linear issue exists",
    confidence: 0.55,
    confidenceExplanation: "I observed a similar sequence 2 times. That is the minimum for a proposal, so treat this as tentative.",
    scoreComponents: { sequenceSimilarity: 0.7, repeatCount: 0.4, triggerConsistency: 0.5, outcomeConsistency: 0.6, timeCost: 0.2, lowRiskCoverage: 0.4 },
    riskClass: "internal_mutation",
    suppression: { state: "not_useful", reason: "user", ts: NOW - 30 * MIN },
    apps: ["Google Chrome"],
    domains: ["linear.app"],
    createdAt: NOW - 3 * 60 * MIN,
    updatedAt: NOW - 30 * MIN,
    patternKey: "pk-2"
  }
];

export const sampleSkill: Skill = {
  id: "skill-1",
  version: 2,
  name: "Meeting follow-up email",
  description: "Draft a follow-up email from the latest Notion meeting note.",
  trigger: "After a meeting note is opened in Notion",
  preconditions: ["Mail is signed in"],
  variables: sampleCandidates[0]?.variables ?? [],
  subtasks: [
    { id: "st-1", title: "Copy action items", goal: "Copy the action items from the open Notion note", completionCriteria: "Clipboard contains the action items", keySteps: ["Scroll to Action items", "Select the list", "Copy"], completionPredicates: [{ kind: "user_confirm" }], appOrDomain: "notion.so" },
    { id: "st-2", title: "Draft the email", goal: "Create a new Mail message with the action items", completionCriteria: "A draft with the action items is open", keySteps: ["Switch to Mail", "New message", "Paste"], completionPredicates: [{ kind: "app_frontmost", bundleId: "com.apple.mail" }], appOrDomain: "Mail" }
  ],
  allowedApps: ["com.google.Chrome", "com.apple.mail"],
  allowedDomains: ["notion.so"],
  policy: { mode: "guide", allowLowRiskRunApproval: true, allowNavigationRunApproval: false, requireTypingApproval: true, neverAutoSend: true },
  maxSteps: 40,
  timeoutMs: 15 * MIN,
  riskClass: "external_communication",
  evidence: { episodeIds: ["ep-1"], candidateId: "cand-1" },
  corrections: [{ ts: NOW - 50 * MIN, field: "trigger", note: "Clarified the trigger wording", fromVersion: 1 }],
  successCriteria: ["Draft contains every action item", "No email is sent automatically"],
  source: "candidate",
  createdAt: NOW - 90 * MIN,
  updatedAt: NOW - 50 * MIN,
  archived: false
};

export const sampleSkillV1: Skill = { ...sampleSkill, version: 1, trigger: "After a meeting", corrections: [], updatedAt: NOW - 90 * MIN };

export const sampleRun: Run = {
  id: "run-1",
  skillId: "skill-1",
  skillVersion: 2,
  skillName: "Meeting follow-up email",
  mode: "guide",
  status: "awaiting_approval",
  currentSubtaskIndex: 1,
  subtaskCount: 2,
  startedAt: NOW - 4 * MIN,
  failureCategory: "none",
  provider: "mock",
  model: "mock-vision-1",
  metrics: { steps: 2, approvedActions: 1, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 40, modelLatencyMsMax: 25, screenshotsUsed: 2 },
  lowRiskRunApproval: false,
  navigationRunApproval: false,
  summary: ""
};

export const sampleFinishedRun: Run = { ...sampleRun, id: "run-0", status: "completed", startedAt: NOW - 60 * MIN, endedAt: NOW - 55 * MIN, currentSubtaskIndex: 2, summary: "Draft created with 3 action items." };

const shotBase = { screenshotId: "shot-1", width: 1440, height: 900 };

export const sampleSteps: RunStep[] = [
  {
    id: "step-1",
    runId: "run-1",
    index: 0,
    subtaskIndex: 0,
    ts: NOW - 3 * MIN,
    screenshotRef: "shot-1",
    proposed: { type: "click", x: 640, y: 420, button: "left", purpose: "Select the action items heading", expectedResult: "Heading is focused", confidence: 0.8, sourceScreenshot: shotBase, subtaskIndex: 0 },
    actionSummary: "Click the Action items heading",
    rationale: "The heading is visible at the centre of the note.",
    validation: { ok: true, errors: [], targetDriftPx: 0, resolvedTarget: { source: "ocr", label: "Action items" } },
    risk: { riskClass: "read_only", decision: "approve", reasons: ["Click on a heading in an allowed domain"], matchedTerms: [], coveredByRunApproval: false },
    approval: { decision: "approved", scope: "once", ts: NOW - 3 * MIN + 5000 },
    executed: { type: "click", x: 320, y: 210, button: "left" },
    verification: { passed: true, subtaskComplete: false, method: "screen_diff_ocr", evidence: "Heading highlighted", confidence: 0.7 },
    timing: { captureMs: 80, proposeMs: 25, approvalWaitMs: 5000, executeMs: 40, verifyMs: 120, totalMs: 5265 },
    failureCategory: "none",
    userInterrupted: false
  },
  {
    id: "step-2",
    runId: "run-1",
    index: 1,
    subtaskIndex: 1,
    ts: NOW - MIN,
    screenshotRef: "shot-2",
    proposed: { type: "type_text", text: "Follow-up: action items from today", purpose: "Enter the subject line", expectedResult: "Subject field is filled", confidence: 0.75, sourceScreenshot: shotBase, subtaskIndex: 1 },
    actionSummary: "Type the subject line",
    rationale: "The subject field is empty and focused.",
    validation: { ok: true, errors: [] },
    risk: { riskClass: "external_communication", decision: "approve_strong", reasons: ["Typing into a mail client"], matchedTerms: ["mail"], coveredByRunApproval: false },
    approval: null,
    executed: null,
    verification: null,
    timing: { captureMs: 70, proposeMs: 30, approvalWaitMs: 0, executeMs: 0, verifyMs: 0, totalMs: 100 },
    failureCategory: "none",
    userInterrupted: false
  }
];

export const sampleFeedback: Feedback[] = [
  {
    id: "fb-1",
    contextType: "candidate",
    contextId: "cand-2",
    answers: { kind: "candidate", relevant: false, wouldDelegate: "no", boundaryAccuracy: "correct", reasonCodes: ["too_simple"] },
    consent: { localStored: true, remoteUpload: false, commentWarningShown: false },
    sanitization: { ok: true, removedFields: [] },
    uploadStatus: "local_only",
    appVersion: "0.1.0-alpha.1",
    modelInfo: { provider: "mock", model: "mock-vision-1" },
    performance: {},
    createdAt: NOW - 30 * MIN
  }
];

/** 1x1 transparent PNG used for mock screenshots. */
export const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
