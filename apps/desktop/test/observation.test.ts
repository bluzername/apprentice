import { describe, expect, it } from "vitest";
import { eventToToken } from "@apprentice/core";
import type { AccessibilityContextAtPointResult } from "@apprentice/schemas";
import { createRecordingEmitter } from "../src/main/services/events.js";
import { FakeHelperClient, type FakeResponder } from "../src/main/services/helper/fake-helper-client.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import { systemClock } from "../src/main/services/clock.js";
import { CaptureService } from "../src/main/services/observation/capture-service.js";
import { ObservationPipeline } from "../src/main/services/observation/pipeline.js";
import { FixtureScreenSource } from "../src/main/services/observation/screen-source.js";
import { fixtures, makeContext, sleep } from "./helpers.js";

interface SetupOptions {
  readonly ax?: FakeResponder;
  readonly clickAxTimeoutMs?: number;
}

async function setup(options: SetupOptions = {}) {
  const context = makeContext();
  context.settings.update({ allowlist: { apps: [{ bundleId: "com.google.Chrome", name: "Google Chrome" }], domains: ["crm.example"] } });
  const helper = new FakeHelperClient({
    ocr: () => ({ width: 100, height: 60, blocks: [{ text: "Log activity", x: 1, y: 1, width: 50, height: 10, confidence: 0.9 }] }),
    responses: options.ax ? { accessibilityContextAtPoint: options.ax } : {}
  });
  await helper.start();
  const screen = new FixtureScreenSource({ readPng: (name) => fixtures.readScreenshotPng(name), initial: "crmContact" });
  const capture = new CaptureService({ storage: context.storage, screenSource: screen, ocr: (png) => helper.ocrImage(png), resizer: nodePngResizer, metrics: context.metrics, clock: systemClock, logger: silentLogger, sessionId: context.sessionId });
  const recorder = createRecordingEmitter();
  const state = { capturing: true };
  const pipeline = new ObservationPipeline({ storage: context.storage, settings: context.settings, helper, capture, sessionId: context.sessionId, emit: recorder.emit, clock: systemClock, logger: silentLogger, metrics: context.metrics, isCapturing: () => state.capturing, flushIntervalMs: 10, clickSettleMs: 5, intervalMs: 60_000, clickAxTimeoutMs: options.clickAxTimeoutMs ?? 100 });
  await pipeline.start();
  pipeline.flush();
  return { context, helper, screen, capture, pipeline, recorder, state };
}

describe("observation pipeline", () => {
  it("stores exactly one privacy_gap for focus outside the allowlist and nothing else", async () => {
    const { helper, pipeline, context } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: "com.apple.Safari", name: "Safari", pid: 1 });
    helper.emit("windowTitleChanged", { bundleId: "com.apple.Safari", title: "Bank statement" });
    helper.emit("mouseDown", { x: 10, y: 10, button: "left", bundleId: "com.apple.Safari" });
    helper.emit("shortcut", { keys: ["cmd", "c"], bundleId: "com.apple.Safari" });
    pipeline.flush();
    const events = context.storage.current.events.query({ limit: 100 }, { revealSensitive: true });
    expect(events.filter((event) => event.type === "privacy_gap")).toHaveLength(1);
    expect(events.some((event) => event.type === "window_title_changed" || event.type === "mouse_down" || event.type === "shortcut")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Bank statement");
    await pipeline.shutdown();
  });

  it("stores allowed events with encrypted titles and captures a screenshot with encrypted OCR", async () => {
    const { helper, pipeline, capture, context, recorder } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 2 });
    helper.emit("windowTitleChanged", { bundleId: "com.google.Chrome", windowId: 7, title: "Quarterly plan - Jordan Rivera" });
    helper.emit("shortcut", { keys: ["cmd", "shift", "p"], bundleId: "com.google.Chrome" });
    pipeline.flush();
    await capture.idle();
    const storage = context.storage.current;
    const events = storage.events.query({ limit: 100 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["app_activated", "window_title_changed", "shortcut"]));
    const titled = events.find((event) => event.type === "window_title_changed")!;
    expect(titled.payload?.title).toBeUndefined();
    const raw = storage.db.get<{ json: string; sensitive_enc: Uint8Array | null }>("SELECT json, sensitive_enc FROM events WHERE id = ?", titled.id)!;
    expect(raw.json).not.toContain("Jordan Rivera");
    expect(raw.sensitive_enc).not.toBeNull();
    expect(storage.events.byIds([titled.id], { revealSensitive: true })[0]?.payload?.title).toBe("Quarterly plan - Jordan Rivera");
    expect(capture.stats().captured).toBe(1);
    expect(storage.screenshots.count()).toBe(1);
    const shot = storage.screenshots.inRange(0, Date.now() + 1000)[0]!;
    expect(shot.reason).toBe("app_change");
    expect(shot.app?.bundleId).toBe("com.google.Chrome");
    const ocrRow = storage.db.get<{ json_enc: Uint8Array }>("SELECT json_enc FROM ocr WHERE screenshot_id = ?", shot.id)!;
    expect(Buffer.from(ocrRow.json_enc).toString("utf8")).not.toContain("Log activity");
    expect(storage.screenshots.getOcrForScreenshot(shot.id)?.blocks[0]?.text).toBe("Log activity");
    expect(recorder.of("event:activity").length).toBeGreaterThan(0);
    await pipeline.shutdown();
  });

  it("honours the capture throttle, click settle, and perceptual dedup", async () => {
    const { helper, pipeline, capture } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 2 });
    helper.emit("windowTitleChanged", { bundleId: "com.google.Chrome", title: "One" });
    helper.emit("mouseDown", { x: 10, y: 10, button: "left", bundleId: "com.google.Chrome" });
    await sleep(30);
    await capture.idle();
    expect(capture.stats().captured).toBe(1);
    pipeline.insertTeachMarker();
    await capture.idle();
    const stats = capture.stats();
    expect(stats.captured).toBe(1);
    expect(stats.deduplicated).toBe(1);
    await pipeline.shutdown();
  });

  it("pauses capture on a secure field until the next context change", async () => {
    const { helper, pipeline, capture, context, screen } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 2 });
    await capture.idle();
    expect(capture.stats().captured).toBe(1);
    helper.emit("secureFieldFocused", { bundleId: "com.google.Chrome", role: "AXSecureTextField" });
    screen.setTemplate("mailCompose");
    pipeline.insertTeachMarker();
    await capture.idle();
    expect(capture.stats().captured).toBe(1);
    pipeline.flush();
    const sensitive = context.storage.current.events.query({ types: ["secure_field_focused"] });
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]?.privacy).toBe("sensitive");
    helper.emit("windowTitleChanged", { bundleId: "com.google.Chrome", title: "Back to work" });
    pipeline.insertTeachMarker();
    await capture.idle();
    expect(capture.stats().captured).toBe(2);
    await pipeline.shutdown();
  });

  it("re-checks the allowlist for extension events and reports accepted/dropped", async () => {
    const { pipeline, context } = await setup();
    const result = pipeline.ingestExtensionBatch([
      { id: "x1", ts: Date.now(), type: "navigation", domain: "crm.example", path: "/contact/1042" },
      { id: "x2", ts: Date.now(), type: "click", domain: "crm.example", element: { role: "button", name: "Log activity" } },
      { id: "x3", ts: Date.now(), type: "navigation", domain: "evil.example", path: "/" },
      { id: "x4", ts: Date.now(), type: "page_title", domain: "evil.example", title: "Evil" }
    ]);
    expect(result).toEqual({ accepted: 2, dropped: 2 });
    pipeline.flush();
    const events = context.storage.current.events.query({ limit: 100 });
    expect(events.find((event) => event.type === "navigation")?.routePattern).toBe("/contact/:id");
    expect(events.filter((event) => event.type === "privacy_gap")).toHaveLength(1);
    expect(pipeline.latestNavigation()?.domain).toBe("crm.example");
    await pipeline.shutdown();
  });

  it("does nothing while not learning", async () => {
    const { helper, pipeline, context, state } = await setup();
    state.capturing = false;
    const before = context.storage.current.events.count();
    helper.emit("frontmostAppChanged", { bundleId: "com.google.Chrome", name: "Google Chrome", pid: 2 });
    expect(pipeline.ingestExtensionBatch([{ id: "y", ts: Date.now(), type: "navigation", domain: "crm.example", path: "/" }])).toEqual({ accepted: 0, dropped: 1 });
    pipeline.flush();
    expect(context.storage.current.events.count()).toBe(before);
    await pipeline.shutdown();
  });
});

const CHROME = "com.google.Chrome";

/** Raw helper reply as the process client would see it before schema parsing. */
function axResult(partial: { element?: Record<string, unknown> | null; ancestors?: AccessibilityContextAtPointResult["ancestors"] }): Record<string, unknown> {
  return { element: null, ancestors: [], bundleId: CHROME, ...partial };
}

describe("native click enrichment", () => {
  it("attaches the role and redacted name from the accessibility element under the click", async () => {
    const { helper, pipeline, context } = await setup({ ax: () => axResult({ element: { role: "AXButton", title: "Save jane@example.com", identifier: "save-btn" } }) });
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 120.4, y: 40.6, button: "left", bundleId: CHROME });
    await pipeline.settleEnrichments();
    pipeline.flush();
    const click = context.storage.current.events.query({ types: ["mouse_down"] })[0]!;
    expect(click.element).toEqual({ role: "button", name: "Save [email]", identifier: "save-btn" });
    expect(eventToToken(click)).toBe("app:chrome|action:click|role:button|name:save-email");
    expect(helper.requests.find((request) => request.cmd === "accessibilityContextAtPoint")?.params).toEqual({ x: 120, y: 41 });
    await pipeline.shutdown();
  });

  it("falls back to the nearest titled ancestor when the element has no title", async () => {
    const { helper, pipeline, context } = await setup({
      ax: () => axResult({ element: { role: "AXButton" }, ancestors: [{ role: "AXGroup" }, { role: "AXToolbar", title: "Formatting" }, { role: "AXWindow", title: "Doc - Google Docs" }] })
    });
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 5, y: 5, button: "left", bundleId: CHROME });
    await pipeline.settleEnrichments();
    pipeline.flush();
    const click = context.storage.current.events.query({ types: ["mouse_down"] })[0]!;
    expect(click.element).toEqual({ role: "button", name: "Formatting" });
    expect(eventToToken(click)).toBe("app:chrome|action:click|role:button|name:formatting");
    await pipeline.shutdown();
  });

  it("stores a plain click when the lookup times out and keeps later events behind it in order", async () => {
    const { helper, pipeline, context } = await setup({ ax: () => new Promise(() => undefined), clickAxTimeoutMs: 30 });
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 5, y: 5, button: "left", bundleId: CHROME });
    helper.emit("shortcut", { keys: ["cmd", "c"], bundleId: CHROME });
    expect(pipeline.pendingEnrichments).toBe(1);
    const early = pipeline.flush();
    expect(early.map((event) => event.type)).not.toContain("shortcut");
    expect(context.storage.current.events.query({ types: ["shortcut"] })).toHaveLength(0);
    await pipeline.settleEnrichments();
    pipeline.flush();
    const stored = context.storage.current.events.query({ types: ["mouse_down", "shortcut"] });
    expect(stored.map((event) => event.type)).toEqual(["mouse_down", "shortcut"]);
    expect(stored[0]!.seq).toBeLessThan(stored[1]!.seq);
    expect(stored[0]!.element).toBeUndefined();
    expect(eventToToken(stored[0]!)).toBe("app:chrome|action:click");
    expect(context.metrics.counters()["click.enrichmentFailed"]).toBe(1);
    await pipeline.shutdown();
  });

  it("prefers the helper's resolved name over the ancestor fallback", async () => {
    const { helper, pipeline, context } = await setup({
      ax: () => axResult({ element: { role: "AXTextField", name: "download-1.pdf", nameSource: "descendant", valueLength: 14 }, ancestors: [{ role: "AXCell" }, { role: "AXRow" }, { role: "AXWindow", title: "Apprentice-test-invoices" }] })
    });
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 5, y: 5, button: "left", bundleId: CHROME });
    await pipeline.settleEnrichments();
    pipeline.flush();
    const click = context.storage.current.events.query({ types: ["mouse_down"] })[0]!;
    expect(click.element).toEqual({ role: "textbox", name: "download-1.pdf" });
    await pipeline.shutdown();
  });

  it("collapses a double click into one mouse_down with count 2 and enriches it once", async () => {
    const { helper, pipeline, context } = await setup({ ax: () => axResult({ element: { role: "AXRow", name: "download-1.pdf", nameSource: "descendant" } }) });
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 100, y: 200, button: "left", bundleId: CHROME });
    helper.emit("mouseDown", { x: 103, y: 198, button: "left", bundleId: CHROME });
    await pipeline.settleEnrichments();
    pipeline.flush();
    const clicks = context.storage.current.events.query({ types: ["mouse_down"] });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.payload).toEqual({ x: 100, y: 200, button: "left", count: 2 });
    expect(clicks[0]!.element).toEqual({ role: "row", name: "download-1.pdf" });
    expect(helper.requests.filter((request) => request.cmd === "accessibilityContextAtPoint")).toHaveLength(1);
    expect(context.metrics.counters()["click.collapsed"]).toBe(1);
    await pipeline.shutdown();
  });

  it("keeps clicks apart when they are too far in space or time, or in another app", async () => {
    let now = 1_000_000;
    const context = makeContext();
    context.settings.update({ allowlist: { apps: [{ bundleId: CHROME, name: "Google Chrome" }, { bundleId: "com.apple.finder", name: "Finder" }], domains: [] } });
    const helper = new FakeHelperClient({ now: () => now });
    await helper.start();
    const screen = new FixtureScreenSource({ readPng: (name) => fixtures.readScreenshotPng(name), initial: "crmContact" });
    const capture = new CaptureService({ storage: context.storage, screenSource: screen, ocr: (png) => helper.ocrImage(png), resizer: nodePngResizer, metrics: context.metrics, clock: systemClock, logger: silentLogger, sessionId: context.sessionId });
    const pipeline = new ObservationPipeline({ storage: context.storage, settings: context.settings, helper, capture, sessionId: context.sessionId, emit: createRecordingEmitter().emit, clock: systemClock, logger: silentLogger, metrics: context.metrics, isCapturing: () => true, flushIntervalMs: 10_000, clickSettleMs: 5, intervalMs: 60_000, clickAxTimeoutMs: 100 });
    await pipeline.start();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 100, y: 200, button: "left", bundleId: CHROME });
    helper.emit("mouseDown", { x: 120, y: 200, button: "left", bundleId: CHROME });
    now += 351;
    helper.emit("mouseDown", { x: 120, y: 200, button: "left", bundleId: CHROME });
    helper.emit("frontmostAppChanged", { bundleId: "com.apple.finder", name: "Finder", pid: 3 });
    helper.emit("mouseDown", { x: 120, y: 200, button: "left", bundleId: "com.apple.finder" });
    now += 100;
    helper.emit("mouseDown", { x: 121, y: 201, button: "left", bundleId: "com.apple.finder" });
    await pipeline.settleEnrichments();
    pipeline.flush();
    const clicks = context.storage.current.events.query({ types: ["mouse_down"] });
    expect(clicks.map((click) => [click.app?.bundleId, click.payload?.["x"], click.payload?.["count"]])).toEqual([
      [CHROME, 100, undefined],
      [CHROME, 120, undefined],
      [CHROME, 120, undefined],
      ["com.apple.finder", 120, 2]
    ]);
    await pipeline.shutdown();
  });

  it("never leaks secure field contents, even when the helper misbehaves", async () => {
    const secure = { role: "AXSecureTextField", title: "Password", isSecure: true, valueLength: 7 };
    const { helper, pipeline, context } = await setup({ ax: () => axResult({ element: secure }) });
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("mouseDown", { x: 5, y: 5, button: "left", bundleId: CHROME });
    await pipeline.settleEnrichments();
    pipeline.flush();
    const click = context.storage.current.events.query({ types: ["mouse_down"] })[0]!;
    expect(click.element).toEqual({ role: "secure-text-field" });
    const leaky = new FakeHelperClient({ responses: { accessibilityContextAtPoint: () => axResult({ element: { role: "AXTextField", title: "Card", value: "4111 1111 1111 1111" } }) } });
    await leaky.start();
    await expect(leaky.accessibilityContextAtPoint(1, 1)).rejects.toThrow();
    expect(JSON.stringify(context.storage.current.events.query({ limit: 100 }, { revealSensitive: true }))).not.toContain("4111");
    await pipeline.shutdown();
  });
});

describe("browser view titles", () => {
  it("stores coarse site and view in plain text while the title stays encrypted, and tokens the view", async () => {
    const { helper, pipeline, context } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("windowTitleChanged", { bundleId: CHROME, title: "Inbox (843) - jordan.rivera@example.com - Gmail" });
    helper.emit("windowTitleChanged", { bundleId: CHROME, title: "Pipeline Q3 - Google Sheets" });
    pipeline.flush();
    const events = context.storage.current.events.query({ types: ["window_title_changed"] });
    expect(events.map((event) => event.payload?.["site"])).toEqual(["gmail", "google-sheets"]);
    expect(events.map((event) => event.payload?.["view"])).toEqual(["inbox", "document"]);
    expect(events.map((event) => eventToToken(event))).toEqual(["app:chrome|site:gmail|view:inbox|action:view", "app:chrome|site:google-sheets|view:document|action:view"]);
    const raw = context.storage.current.db.get<{ json: string }>("SELECT json FROM events WHERE id = ?", events[0]!.id)!;
    expect(raw.json).not.toMatch(/jordan|\(843\)|Inbox/);
    await pipeline.shutdown();
  });

  it("marks login views sensitive and pauses capture until the next context change", async () => {
    const { helper, pipeline, capture, context } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    await capture.idle();
    expect(capture.stats().captured).toBe(1);
    helper.emit("windowTitleChanged", { bundleId: CHROME, title: "Sign in - Google Accounts" });
    pipeline.insertTeachMarker();
    await capture.idle();
    expect(capture.stats().captured).toBe(1);
    pipeline.flush();
    const login = context.storage.current.events.query({ types: ["window_title_changed"] })[0]!;
    expect(login.privacy).toBe("sensitive");
    expect(login.payload?.["view"]).toBe("login");
    expect(login.payload?.["sensitive"]).toBe(true);
    await pipeline.shutdown();
  });
});

describe("screenshot attachment", () => {
  it("links a click capture to its event on both sides", async () => {
    const { helper, pipeline, capture, context, screen } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    await capture.idle();
    screen.setTemplate("mailCompose");
    capture.resetThrottle();
    helper.emit("mouseDown", { x: 10, y: 10, button: "left", bundleId: CHROME });
    await pipeline.settleEnrichments();
    await sleep(30);
    await capture.idle();
    pipeline.flush();
    const storage = context.storage.current;
    const click = storage.events.query({ types: ["mouse_down"] })[0]!;
    const shot = storage.screenshots.inRange(0, Date.now() + 1000).find((record) => record.reason === "click")!;
    expect(shot).toBeDefined();
    expect(shot.eventId).toBe(click.id);
    expect(click.screenshotRef).toBe(shot.id);
    await pipeline.shutdown();
  });

  it("updates an event that was already written when its capture finishes later", async () => {
    const { helper, pipeline, capture, context, recorder } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    const written = pipeline.flush();
    const activated = written.find((event) => event.type === "app_activated")!;
    expect(activated.screenshotRef).toBeUndefined();
    await capture.idle();
    const storage = context.storage.current;
    const shot = storage.screenshots.inRange(0, Date.now() + 1000)[0]!;
    expect(shot.eventId).toBe(activated.id);
    const stored = storage.events.byIds([activated.id])[0]!;
    expect(stored.screenshotRef).toBe(shot.id);
    const update = recorder.of("event:activity").find((payload) => payload.events.some((event) => event.id === activated.id && event.screenshotRef === shot.id));
    expect(update?.screenshots?.map((record) => record.id)).toEqual([shot.id]);
    await pipeline.shutdown();
  });

  it("attaches an interval capture to the most recent allowed event of the same app", async () => {
    const { helper, pipeline, capture, context, screen } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    await capture.idle();
    helper.emit("shortcut", { keys: ["cmd", "s"], bundleId: CHROME });
    pipeline.flush();
    screen.setTemplate("mailCompose");
    capture.resetThrottle();
    capture.request("interval", { app: { bundleId: CHROME, name: "Google Chrome" } });
    await capture.idle();
    const storage = context.storage.current;
    const shortcut = storage.events.query({ types: ["shortcut"] })[0]!;
    const interval = storage.screenshots.inRange(0, Date.now() + 1000).find((record) => record.reason === "interval")!;
    expect(interval.eventId).toBe(shortcut.id);
    expect(storage.events.byIds([shortcut.id])[0]!.screenshotRef).toBe(interval.id);
    await pipeline.shutdown();
  });

  it("leaves an interval capture standalone when the recent event already has a screenshot or is too old", async () => {
    const { helper, pipeline, capture, context, screen } = await setup();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    await capture.idle();
    pipeline.flush();
    screen.setTemplate("mailCompose");
    capture.resetThrottle();
    capture.request("interval", { app: { bundleId: CHROME, name: "Google Chrome" } });
    await capture.idle();
    const storage = context.storage.current;
    const records = storage.screenshots.inRange(0, Date.now() + 1000);
    expect(records.map((record) => record.reason)).toEqual(["app_change", "interval"]);
    expect(records[1]!.eventId).toBeUndefined();
    await pipeline.shutdown();
  });
});

describe("helper timestamps", () => {
  it("rounds fractional helper timestamps so the whole batch is stored", async () => {
    const helper = new FakeHelperClient({ now: () => 1_700_000_000_000.75 });
    const context = makeContext();
    context.settings.update({ allowlist: { apps: [{ bundleId: CHROME, name: "Google Chrome" }], domains: [] } });
    await helper.start();
    const capture = new CaptureService({ storage: context.storage, screenSource: new FixtureScreenSource({ readPng: (name) => fixtures.readScreenshotPng(name), initial: "crmContact" }), ocr: (png) => helper.ocrImage(png), resizer: nodePngResizer, metrics: context.metrics, clock: systemClock, logger: silentLogger, sessionId: context.sessionId });
    const pipeline = new ObservationPipeline({ storage: context.storage, settings: context.settings, helper, capture, sessionId: context.sessionId, emit: createRecordingEmitter().emit, clock: systemClock, logger: silentLogger, metrics: context.metrics, isCapturing: () => true, flushIntervalMs: 10, intervalMs: 60_000 });
    await pipeline.start();
    pipeline.flush();
    helper.emit("frontmostAppChanged", { bundleId: CHROME, name: "Google Chrome", pid: 2 });
    helper.emit("shortcut", { keys: ["cmd", "s"], bundleId: CHROME });
    helper.emit("windowTitleChanged", { bundleId: CHROME, title: "Doc - Google Docs" });
    await pipeline.settleEnrichments();
    const written = pipeline.flush();
    expect(written).toHaveLength(3);
    const stored = context.storage.current.events.query({ types: ["app_activated", "shortcut", "window_title_changed"] });
    expect(stored).toHaveLength(3);
    for (const event of stored) expect(event.ts).toBe(1_700_000_000_001);
    expect(context.metrics.counters()["events.invalid"]).toBeUndefined();
    await pipeline.shutdown();
  });
});
