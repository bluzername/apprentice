import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { openStorage, type Storage } from "../src/main/storage/index.js";
import { loadOrCreateMasterKey, createFakeProtector, SecretStore, deleteMasterKey } from "../src/main/security/keys.js";
import type { ActivityEvent, Skill } from "@apprentice/schemas";

function makeEvent(i: number, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: `evt_${i}`,
    ts: 1_700_000_000_000 + i * 1000,
    seq: i,
    sessionId: "s1",
    source: "native_helper",
    type: "app_activated",
    app: { bundleId: "com.google.Chrome", name: "Google Chrome" },
    privacy: "allowed",
    redaction: "none_needed",
    ...overrides
  };
}

describe("storage", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apprentice-storage-"));
    storage = openStorage({ databasePath: join(dir, "db.sqlite"), screenshotsDir: join(dir, "shots"), masterKey: randomBytes(32) });
  });
  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("insertValidated stores the valid events of a batch and reports the invalid ones", () => {
    const fractional = makeEvent(2, { ts: 1_700_000_000_000.75 });
    const result = storage.events.insertValidated([makeEvent(1), fractional, makeEvent(3)]);
    expect(result.inserted.map((event) => event.id)).toEqual(["evt_1", "evt_3"]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.id).toBe("evt_2");
    expect(result.rejected[0]!.error).toMatch(/ts/);
    expect(storage.events.count()).toBe(2);
    expect(() => storage.events.insertMany([makeEvent(4), fractional])).toThrow();
    expect(storage.events.count()).toBe(2);
    expect(storage.events.insertValidated([])).toEqual({ inserted: [], rejected: [] });
  });

  it("applies migrations once and is idempotent", () => {
    const again = storage.db.migrate();
    expect(again.applied).toBe(0);
    expect(again.version).toBeGreaterThanOrEqual(1);
  });

  it("stores events and keeps window titles encrypted at rest", () => {
    const titled = makeEvent(1, { type: "window_title_changed", payload: { title: "Quarterly plan - Jordan Rivera", windowId: 4 } });
    storage.events.insertMany([makeEvent(0), titled]);
    const raw = storage.db.get<{ json: string; sensitive_enc: Uint8Array | null }>("SELECT json, sensitive_enc FROM events WHERE id = ?", "evt_1");
    expect(raw?.json).not.toContain("Jordan Rivera");
    expect(raw?.sensitive_enc).not.toBeNull();
    const hidden = storage.events.query({ limit: 10 });
    expect(hidden[1]?.payload?.title).toBeUndefined();
    expect(hidden[1]?.payload?.windowId).toBe(4);
    const revealed = storage.events.query({ limit: 10 }, { revealSensitive: true });
    expect(revealed[1]?.payload?.title).toBe("Quarterly plan - Jordan Rivera");
  });

  it("setScreenshotRef rewrites the indexable json and leaves the encrypted payload untouched", () => {
    const titled = makeEvent(1, { type: "window_title_changed", payload: { title: "Quarterly plan - Jordan Rivera", windowId: 4 } });
    storage.events.insertMany([titled]);
    const before = storage.db.get<{ sensitive_enc: Uint8Array | null }>("SELECT sensitive_enc FROM events WHERE id = ?", "evt_1")!;
    const updated = storage.events.setScreenshotRef("evt_1", "shot_9");
    expect(updated?.screenshotRef).toBe("shot_9");
    expect(updated?.payload?.title).toBeUndefined();
    const after = storage.db.get<{ json: string; sensitive_enc: Uint8Array | null }>("SELECT json, sensitive_enc FROM events WHERE id = ?", "evt_1")!;
    expect(after.json).toContain("shot_9");
    expect(after.json).not.toContain("Jordan Rivera");
    expect(Buffer.from(after.sensitive_enc!).equals(Buffer.from(before.sensitive_enc!))).toBe(true);
    expect(storage.events.query({ limit: 10 }, { revealSensitive: true })[0]?.payload?.title).toBe("Quarterly plan - Jordan Rivera");
    expect(storage.events.setScreenshotRef("evt_missing", "shot_9")).toBeNull();
    expect(() => storage.events.setScreenshotRef("evt_1", "")).toThrow();
  });

  it("setEventId keeps the screenshot index column and json in step", () => {
    storage.screenshots.insert({ id: "shot_1", ts: 1, sessionId: "s1", width: 10, height: 10, displayScale: 2, perceptualHash: "abcd", byteLength: 10, reason: "interval", analyzed: false });
    expect(storage.screenshots.setEventId("shot_1", "evt_1")?.eventId).toBe("evt_1");
    expect(storage.screenshots.get("shot_1")?.eventId).toBe("evt_1");
    expect(storage.db.get<{ event_id: string | null }>("SELECT event_id FROM screenshots WHERE id = ?", "shot_1")?.event_id).toBe("evt_1");
    expect(storage.screenshots.setEventId("shot_missing", "evt_1")).toBeNull();
  });

  it("filters, counts, and deletes events", () => {
    storage.events.insertMany([0, 1, 2, 3].map((i) => makeEvent(i, i % 2 ? { domain: "crm.example", type: "click", source: "extension" } : {})));
    expect(storage.events.count()).toBe(4);
    expect(storage.events.query({ domain: "crm.example" })).toHaveLength(2);
    expect(storage.events.query({ types: ["click"] })).toHaveLength(2);
    expect(storage.events.deleteByIds(["evt_0"])).toBe(1);
    expect(storage.events.deleteRange(1_700_000_001_000, 1_700_000_002_000)).toBe(2);
    expect(storage.events.count()).toBe(1);
  });

  it("encrypts screenshot blobs on disk and round-trips them", () => {
    const png = Buffer.from("not-really-a-png-but-bytes-" + "x".repeat(500));
    const written = storage.blobs.write("shot_1", png);
    expect(existsSync(written.path)).toBe(true);
    const onDisk = readFileSync(written.path);
    expect(onDisk.includes(Buffer.from("not-really"))).toBe(false);
    expect(storage.blobs.read("shot_1")?.equals(png)).toBe(true);
    expect(storage.blobs.totalBytes().count).toBe(1);
    expect(() => storage.blobs.read("../evil")).toThrow();
    expect(storage.blobs.delete("shot_1")).toBe(true);
    expect(storage.blobs.read("shot_1")).toBeNull();
  });

  it("stores OCR encrypted and screenshots metadata", () => {
    storage.screenshots.insert({ id: "shot_1", ts: 1, sessionId: "s1", width: 10, height: 10, displayScale: 2, perceptualHash: "abcd", byteLength: 10, reason: "click", analyzed: false });
    storage.screenshots.insertOcr({ id: "ocr_1", screenshotId: "shot_1", ts: 1, width: 10, height: 10, blocks: [{ text: "Secret Word", x: 0, y: 0, width: 5, height: 5, confidence: 0.9 }] });
    const raw = storage.db.get<{ json_enc: Uint8Array }>("SELECT json_enc FROM ocr WHERE id = ?", "ocr_1");
    expect(Buffer.from(raw!.json_enc).includes(Buffer.from("Secret Word"))).toBe(false);
    expect(storage.screenshots.getOcrForScreenshot("shot_1")?.blocks[0]?.text).toBe("Secret Word");
    storage.screenshots.markAnalyzed("shot_1");
    expect(storage.screenshots.get("shot_1")?.analyzed).toBe(true);
    expect(storage.screenshots.deleteByIds(["shot_1"])).toBe(1);
    expect(storage.screenshots.ocrCount()).toBe(0);
  });

  it("versions skills and lists only current versions", () => {
    const base: Skill = {
      id: "sk_1", version: 1, name: "Test", description: "", trigger: "When", preconditions: [], variables: [],
      subtasks: [{ id: "st1", title: "One", goal: "Do", completionCriteria: "Done", keySteps: [], completionPredicates: [] }],
      allowedApps: [], allowedDomains: [], policy: { mode: "guide", allowLowRiskRunApproval: true, allowNavigationRunApproval: false, requireTypingApproval: true, neverAutoSend: true },
      maxSteps: 10, timeoutMs: 1000, riskClass: "unknown", evidence: { episodeIds: ["ep1"] }, corrections: [], successCriteria: [], source: "taught", createdAt: 1, updatedAt: 1, archived: false
    };
    storage.skills.save(base);
    storage.skills.save({ ...base, version: 2, name: "Test v2", updatedAt: 2 });
    expect(storage.skills.listCurrent()).toHaveLength(1);
    expect(storage.skills.getCurrent("sk_1")?.version).toBe(2);
    expect(storage.skills.history("sk_1")).toHaveLength(2);
    expect(storage.skills.evidenceEpisodeIds().has("ep1")).toBe(true);
  });

  it("persists settings with a stable installation id", () => {
    const first = storage.settings.load();
    expect(first.installationId).toMatch(/^[a-f0-9]{32}$/);
    const updated = storage.settings.update({ demoMode: true });
    expect(updated.demoMode).toBe(true);
    expect(storage.settings.load().installationId).toBe(first.installationId);
    expect(storage.settings.reset().demoMode).toBe(false);
  });

  it("stores pairing with hashed token only", () => {
    storage.pairing.set({ tokenHash: "abc", extensionId: "a".repeat(32), browser: "chrome", createdAt: 1 });
    storage.pairing.touch(3, 5);
    expect(storage.pairing.get()?.eventsReceived).toBe(3);
    storage.pairing.clear();
    expect(storage.pairing.get()).toBeNull();
  });
});

describe("master key", () => {
  it("creates once, reloads the same key, and never writes plaintext", () => {
    const dir = mkdtempSync(join(tmpdir(), "apprentice-keys-"));
    const protector = createFakeProtector();
    const key1 = loadOrCreateMasterKey(dir, protector);
    const key2 = loadOrCreateMasterKey(dir, protector);
    expect(key1.equals(key2)).toBe(true);
    const onDisk = readFileSync(join(dir, "master.key.enc"));
    expect(onDisk.includes(Buffer.from(key1.toString("base64")))).toBe(false);
    const secrets = new SecretStore(dir, protector);
    secrets.set("model_api_key", "sk-test");
    expect(secrets.get("model_api_key")).toBe("sk-test");
    expect(readFileSync(join(dir, "model_api_key.secret.enc")).includes(Buffer.from("sk-test"))).toBe(false);
    expect(deleteMasterKey(dir)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses when the credential store is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "apprentice-keys-"));
    const broken = { ...createFakeProtector(), isEncryptionAvailable: () => false };
    expect(() => loadOrCreateMasterKey(dir, broken)).toThrow(/unavailable/);
    rmSync(dir, { recursive: true, force: true });
  });
});
