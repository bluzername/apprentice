import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORBIDDEN_REMOTE_KEYS, type Feedback, type ProductEvent, type Run, type RunStep } from "@apprentice/schemas";
import { findForbiddenKeys } from "./forbidden-keys.js";
import { assertPathInside, isPathInside } from "./paths.js";
import { buildRemotePayload } from "./payload.js";
import { redactRunTraceForExport } from "./trace.js";
import { assertSafeZipEntryName, isSafeZipEntryName } from "./zip-names.js";
import { createSafeZip, readZipEntries } from "./zip.js";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "apprentice-export-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("zip entry names", () => {
  it("rejects unsafe names and accepts plain relative ones", () => {
    for (const bad of ["../x", "/etc/passwd", "C:\\x", "a\\b", "a/../b", "", "./a", "a//b", "x".repeat(201), "caf\u00e9.txt", "a/", "d:/x"]) {
      expect(() => assertSafeZipEntryName(bad)).toThrow();
      expect(isSafeZipEntryName(bad)).toBe(false);
    }
    for (const good of ["manifest.json", "feedback/1.json", "screenshots/a-b_c.png", "a.b/c.d"]) {
      expect(isSafeZipEntryName(good)).toBe(true);
    }
  });
});

describe("createSafeZip and readZipEntries", () => {
  it("round-trips entries and enforces limits", async () => {
    const out = join(dir, "bundle.zip");
    const entries = [
      { name: "manifest.json", data: Buffer.from('{"bundleVersion":1}') },
      { name: "feedback/f1.json", data: Buffer.from("x".repeat(5000)) }
    ];
    expect(await createSafeZip(entries, out)).toEqual({ fileCount: 2 });
    const read = await readZipEntries(out);
    expect(read.map((entry) => entry.name)).toEqual(["manifest.json", "feedback/f1.json"]);
    expect(read[1]!.data.length).toBe(5000);
    expect(read[0]!.data.toString()).toBe('{"bundleVersion":1}');
    await expect(readZipEntries(out, { maxEntries: 1 })).rejects.toThrow(/entries/);
    await expect(readZipEntries(out, { maxBytes: 100 })).rejects.toThrow(/bytes/);
    await expect(createSafeZip([{ name: "../evil", data: Buffer.from("x") }], join(dir, "evil.zip"))).rejects.toThrow(/upward/);
    await expect(createSafeZip([], join(dir, "empty.zip"))).rejects.toThrow(/no entries/);
    await expect(createSafeZip([entries[0]!, entries[0]!], join(dir, "dup.zip"))).rejects.toThrow(/duplicate/);
  });
});

describe("assertPathInside", () => {
  it("accepts children, rejects traversal and symlink escapes", async () => {
    const root = join(dir, "root");
    const outside = join(dir, "outside");
    await mkdir(join(root, "sub"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, "sub", "file.txt"), "ok");
    await writeFile(join(outside, "secret.txt"), "no");
    await symlink(outside, join(root, "link"));

    expect(await assertPathInside(root, join(root, "sub", "file.txt"))).toMatch(/sub\/file\.txt$/);
    expect(await assertPathInside(root, "sub/new-file.txt")).toMatch(/root\/sub\/new-file\.txt$/);
    expect(await assertPathInside(root, root)).toBe(await assertPathInside(root, "."));
    await expect(assertPathInside(root, join(root, "..", "outside", "secret.txt"))).rejects.toThrow(/escapes/);
    await expect(assertPathInside(root, join(root, "link", "secret.txt"))).rejects.toThrow(/escapes/);
    await expect(assertPathInside(root, join(root, "link"))).rejects.toThrow(/escapes/);
    await expect(assertPathInside("relative", "x")).rejects.toThrow(/absolute/);
    expect(await isPathInside(root, join(root, "sub"))).toBe(true);
    expect(await isPathInside(root, outside)).toBe(false);
  });
});

describe("findForbiddenKeys", () => {
  it("scans deeply and case-insensitively", () => {
    const hits = findForbiddenKeys({ ok: 1, nested: { Title: "x", list: [{ url: "y" }, { fine: 1 }] }, OCR: {} });
    expect(hits).toEqual(["nested.Title", "nested.list[0].url", "OCR"]);
    expect(findForbiddenKeys({ events: [{ name: "run_started" }] }, FORBIDDEN_REMOTE_KEYS, { ignorePaths: ["events[*].name"] })).toEqual([]);
    expect(findForbiddenKeys({ events: [{ name: "x", props: { name: "y" } }] }, FORBIDDEN_REMOTE_KEYS, { ignorePaths: ["events[*].name"] })).toEqual(["events[0].props.name"]);
    expect(findForbiddenKeys(null)).toEqual([]);
    expect(findForbiddenKeys({ a: 1 }, ["a"])).toEqual(["a"]);
  });
});

function feedback(overrides: Partial<Feedback>): Feedback {
  return {
    id: "fb1",
    contextType: "run",
    contextId: "run1",
    answers: { kind: "run", outcomeAchieved: "yes", corrections: 1, estimatedTimeSavedMinutes: 5, trustRating: 4, wouldUseAgain: true, failureCategory: "none" },
    consent: { localStored: true, remoteUpload: true, commentWarningShown: false },
    sanitization: { ok: true, removedFields: [] },
    uploadStatus: "queued",
    appVersion: "0.1.0",
    modelInfo: { provider: "mock" },
    performance: {},
    createdAt: 1000,
    ...overrides
  };
}

const events: ProductEvent[] = [
  { id: "pe1", ts: 1, name: "run_completed", props: { steps: 7, approved: 5, provider: "mock", flag: true, domain: 3 }, riskClass: "internal_mutation", installationId: "abcdef0123456789" },
  { id: "pe2", ts: 2, name: "candidate_generated", props: {}, installationId: "abcdef0123456789" }
];

describe("buildRemotePayload", () => {
  const input = { feedback: [feedback({ comment: "Contains my thoughts" })], events, installationId: "abcdef0123456789", appVersion: "0.1.0", macosMajor: 15, chipFamily: "m3" as const, memoryBucket: "32" as const, provider: "mock" };

  it("keeps numeric counts, drops free-text props and unwarned comments", () => {
    const { payload, removedFields } = buildRemotePayload(input);
    expect(payload.events[0]!.counts).toEqual({ steps: 7, approved: 5 });
    expect(payload.events[0]!.riskClass).toBe("internal_mutation");
    expect(payload.events[1]!.counts).toEqual({});
    expect(removedFields).toEqual(["events[0].props.provider", "events[0].props.flag", "events[0].props.domain", "feedback[0].comment"]);
    expect(payload.feedback[0]!.comment).toBeUndefined();
    expect(payload.feedback[0]!.answers.kind).toBe("run");
    expect(payload.schemaVersion).toBe("1.0");
    expect(findForbiddenKeys(payload, FORBIDDEN_REMOTE_KEYS, { ignorePaths: ["events[*].name"] })).toEqual([]);
  });

  it("includes the comment only after the warning was shown", () => {
    const shown = buildRemotePayload({ ...input, feedback: [feedback({ comment: "ok to share", consent: { localStored: true, remoteUpload: true, commentWarningShown: true } })], participantCode: "ALPHA-7", model: "uimate", performance: { stepLatencyMs: 900 } });
    expect(shown.payload.feedback[0]!.comment).toBe("ok to share");
    expect(shown.removedFields).not.toContain("feedback[0].comment");
    expect(shown.payload.participantCode).toBe("ALPHA-7");
    expect(shown.payload.performance).toEqual({ stepLatencyMs: 900 });
  });

  it("throws on invalid ids or forbidden survivors", () => {
    expect(() => buildRemotePayload({ ...input, installationId: "not-hex" })).toThrow(/validation/);
    expect(() => buildRemotePayload({ ...input, participantCode: "has space" })).toThrow(/validation/);
  });
});

describe("redactRunTraceForExport", () => {
  const run: Run = { id: "run1", skillId: "sk", skillVersion: 1, skillName: "Follow-up", mode: "guide", status: "completed", currentSubtaskIndex: 1, subtaskCount: 2, startedAt: 0, failureCategory: "none", provider: "mock", metrics: { steps: 1, approvedActions: 1, rejectedActions: 0, corrections: 0, modelLatencyMsTotal: 1, modelLatencyMsMax: 1, screenshotsUsed: 1 }, lowRiskRunApproval: false, navigationRunApproval: false, summary: "Logged the call with Alice" };
  const step: RunStep = {
    id: "st1", runId: "run1", index: 0, subtaskIndex: 0, ts: 1, screenshotRef: "shot1", semanticStateRef: "sem1",
    proposed: { type: "type_text", text: "Hello Alice, thanks", purpose: "p", expectedResult: "e", confidence: 0.5, sourceScreenshot: { width: 10, height: 10 }, subtaskIndex: 0 },
    actionSummary: "Type greeting", rationale: "", validation: { ok: true, errors: [], resolvedTarget: { source: "ocr", label: "Message body", role: "textbox" } },
    risk: null, approval: null, executed: { type: "type_text", text: "Hello Alice, thanks" }, verification: { passed: true, subtaskComplete: false, method: "screen_diff_ocr", evidence: "Added: hello alice", confidence: 0.6 },
    timing: { captureMs: 0, proposeMs: 0, approvalWaitMs: 0, executeMs: 0, verifyMs: 0, totalMs: 0 }, failureCategory: "none", userInterrupted: false
  };

  it("strips typed text, refs, labels and OCR evidence without mutating inputs", () => {
    const redacted = redactRunTraceForExport(run, [step]);
    const out = redacted.steps[0]!;
    expect(out.proposed).toMatchObject({ type: "type_text", text: "[redacted len=19]" });
    expect(out.executed).toEqual({ type: "type_text", text: "[redacted len=19]" });
    expect(out.screenshotRef).toBeUndefined();
    expect(out.semanticStateRef).toBeUndefined();
    expect(out.validation?.resolvedTarget).toEqual({ source: "ocr", role: "textbox" });
    expect(out.verification?.evidence).toBe("[redacted len=18]");
    expect(redacted.run.summary).toBe("[redacted len=26]");
    expect(step.screenshotRef).toBe("shot1");
    expect(step.executed).toMatchObject({ text: "Hello Alice, thanks" });
    expect(JSON.stringify(redacted)).not.toMatch(/Alice/);
    expect(redacted.redactedFields.length).toBeGreaterThan(5);
  });
});
