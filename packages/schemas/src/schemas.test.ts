import { describe, expect, it } from "vitest";
import {
  ActivityEventSchema,
  ExecutableActionSchema,
  FORBIDDEN_REMOTE_KEYS,
  IPC_CHANNELS,
  ipcContract,
  ProposedActionSchema,
  RemoteFeedbackPayloadSchema,
  SkillSchema,
  HelperMessageSchema,
  ExtensionEventSchema,
  PRODUCT_NAME
} from "./index.js";
import { EpisodeBoundaryReasonSchema } from "./episodes.js";
import { SettingsPatchSchema } from "./settings.js";

describe("schemas", () => {
  it("exposes the product name from one constant", () => {
    expect(PRODUCT_NAME.length).toBeGreaterThan(0);
  });

  it("validates a minimal activity event", () => {
    const parsed = ActivityEventSchema.safeParse({
      id: "evt_1",
      ts: 1,
      seq: 0,
      sessionId: "s1",
      source: "native_helper",
      type: "app_activated",
      privacy: "allowed",
      redaction: "none_needed"
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unsupported action types from model output", () => {
    const bad = ProposedActionSchema.safeParse({
      type: "shell",
      purpose: "x",
      expectedResult: "y",
      confidence: 0.5,
      sourceScreenshot: { width: 10, height: 10 },
      subtaskIndex: 0
    });
    expect(bad.success).toBe(false);
    const good = ProposedActionSchema.safeParse({
      type: "click",
      x: 5,
      y: 5,
      purpose: "Click the button",
      expectedResult: "Dialog opens",
      confidence: 0.9,
      sourceScreenshot: { width: 10, height: 10 },
      subtaskIndex: 0
    });
    expect(good.success).toBe(true);
  });

  it("only lets app:openExternal open http(s) URLs", () => {
    const schema = ipcContract["app:openExternal"].request;
    expect(schema.safeParse({ url: "https://example.com/docs?x=1" }).success).toBe(true);
    expect(schema.safeParse({ url: "http://127.0.0.1:8080/" }).success).toBe(true);
    const blocked = ["file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.example", "ftp://host/file", "smb://host/share", "x-apple.systempreferences:com.apple.preference.security", "data:text/html,hi", "not a url", "HTTPS//example.com"];
    for (const url of blocked) expect(schema.safeParse({ url }).success, url).toBe(false);
  });

  it("rejects unknown key names in executable actions", () => {
    expect(ExecutableActionSchema.safeParse({ type: "press_key", key: "sudo" }).success).toBe(false);
    expect(ExecutableActionSchema.safeParse({ type: "press_key", key: "enter" }).success).toBe(true);
  });

  it("rejects forbidden fields in the remote feedback payload", () => {
    const base = {
      schemaVersion: "1.0",
      installationId: "abcdef0123456789",
      appVersion: "0.1.0",
      macosMajor: 15,
      chipFamily: "m3",
      memoryBucket: "32",
      provider: "mock",
      events: [],
      feedback: []
    };
    expect(RemoteFeedbackPayloadSchema.safeParse(base).success).toBe(true);
    for (const key of FORBIDDEN_REMOTE_KEYS) {
      expect(RemoteFeedbackPayloadSchema.safeParse({ ...base, [key]: "x" }).success).toBe(false);
    }
  });

  it("requires at least one subtask in a skill", () => {
    const result = SkillSchema.safeParse({
      id: "sk1",
      version: 1,
      name: "Test",
      trigger: "When",
      subtasks: [],
      policy: { mode: "guide" },
      evidence: {},
      source: "taught",
      createdAt: 0,
      updatedAt: 0
    });
    expect(result.success).toBe(false);
  });

  it("parses helper messages by discriminator", () => {
    const ev = HelperMessageSchema.safeParse({ type: "event", v: "1.0", event: "mouseDown", ts: 1, seq: 1, data: { x: 1, y: 2 } });
    expect(ev.success).toBe(true);
    const res = HelperMessageSchema.safeParse({ type: "response", id: "1", v: "1.0", ok: true, result: {} });
    expect(res.success).toBe(true);
    expect(HelperMessageSchema.safeParse({ type: "log", msg: "x" }).success).toBe(false);
  });

  it("extension events are strict and never carry values", () => {
    const ok = ExtensionEventSchema.safeParse({ id: "1", ts: 1, type: "field_input", domain: "crm.example", fieldLabel: "Name", valueLength: 12 });
    expect(ok.success).toBe(true);
    const bad = ExtensionEventSchema.safeParse({ id: "1", ts: 1, type: "field_input", domain: "crm.example", value: "secret" });
    expect(bad.success).toBe(false);
  });

  it("accepts the absorbed_tail episode boundary reason", () => {
    expect(EpisodeBoundaryReasonSchema.parse("absorbed_tail")).toBe("absorbed_tail");
    expect(EpisodeBoundaryReasonSchema.safeParse("trailing").success).toBe(false);
  });

  it("has a non-empty IPC contract", () => {
    expect(IPC_CHANNELS.length).toBeGreaterThan(30);
  });
});

describe("SettingsPatchSchema", () => {
  it("does not re-apply top-level defaults to fields the patch omits", () => {
    const parsed = SettingsPatchSchema.parse({ onboardingStep: 5 });
    expect(parsed).toEqual({ onboardingStep: 5 });
    expect("demoMode" in parsed).toBe(false);
    expect("retention" in parsed).toBe(false);
  });

  it("still validates and keeps fields that are present", () => {
    expect(SettingsPatchSchema.parse({ demoMode: true }).demoMode).toBe(true);
    expect(SettingsPatchSchema.safeParse({ onboardingStep: 99 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ installationId: "abcdef0123456789" }).success).toBe(true);
    expect("installationId" in SettingsPatchSchema.parse({ installationId: "abcdef0123456789" })).toBe(false);
  });
});
