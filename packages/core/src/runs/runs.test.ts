import { describe, expect, it } from "vitest";
import { APP_BUNDLE_ID, type ImageTransform, type ProposedAction } from "@apprentice/schemas";
import { toExecutableAction } from "./executable.js";
import { evaluateCompletionPredicates, stateHash, urlPatternToRegExp } from "./predicates.js";
import { resolveTarget } from "./target.js";
import { foreignHitBundleId, hasControlCharacters, validateProposedAction } from "./validate.js";
import { ocrDiff, verifyStepDeterministic } from "./verify.js";

const base = { purpose: "p", expectedResult: "Dialog opens", confidence: 0.9, sourceScreenshot: { width: 1280, height: 800 }, subtaskIndex: 0 };
const ctx = { screenshotWidth: 1280, screenshotHeight: 800, subtaskCount: 3 };
const transform: ImageTransform = { originalWidth: 2560, originalHeight: 1600, resizedWidth: 1280, resizedHeight: 800, displayScale: 2, originX: 0, originY: 25 };

describe("validateProposedAction", () => {
  it("accepts well-formed actions", () => {
    const ok = validateProposedAction({ ...base, type: "click", x: 100, y: 200, button: "left" }, ctx);
    expect(ok).toEqual({ ok: true, errors: [], resolvedTarget: { source: "coordinates_only" } });
    expect(validateProposedAction({ ...base, type: "type_text", text: "hello\nworld" }, ctx).ok).toBe(true);
    expect(validateProposedAction({ ...base, type: "hotkey", modifiers: ["cmd", "shift"], key: "p" }, ctx).ok).toBe(true);
    expect(validateProposedAction({ ...base, type: "wait", ms: 500 }, ctx).ok).toBe(true);
    expect(validateProposedAction({ ...base, type: "done", summary: "" }, ctx).resolvedTarget).toBeUndefined();
  });

  it("rejects out-of-bounds coordinates, bad subtasks, and screenshot mismatches", () => {
    const out = validateProposedAction({ ...base, type: "click", x: 1280, y: 10, button: "left" }, ctx);
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/x=1280 outside/);
    expect(validateProposedAction({ ...base, type: "move", x: 10, y: -1 }, ctx).errors[0]).toMatch(/y=-1/);
    expect(validateProposedAction({ ...base, type: "click", x: 1, y: 1, button: "left", subtaskIndex: 3 }, ctx).errors[0]).toMatch(/subtask index 3/);
    expect(validateProposedAction({ ...base, type: "click", x: 1, y: 1, button: "left", sourceScreenshot: { width: 640, height: 400 } }, ctx).errors[0]).toMatch(/does not match/);
    expect(validateProposedAction({ ...base, type: "scroll", x: 1, y: 1, deltaX: 0, deltaY: 0 }, ctx).errors[0]).toMatch(/non-zero delta/);
  });

  it("rejects bad text, keys, hotkeys and waits", () => {
    expect(validateProposedAction({ ...base, type: "type_text", text: "x".repeat(2001) }, ctx).errors[0]).toMatch(/exceeds 2000/);
    expect(validateProposedAction({ ...base, type: "type_text", text: `a${String.fromCharCode(7)}b` }, ctx).errors[0]).toMatch(/control characters/);
    expect(hasControlCharacters("plain\ttext\n")).toBe(false);
    expect(hasControlCharacters(String.fromCharCode(127))).toBe(true);
    expect(validateProposedAction({ ...base, type: "press_key", key: "sudo" as never }, ctx).errors[0]).toMatch(/key not allowed/);
    expect(validateProposedAction({ ...base, type: "hotkey", modifiers: ["cmd", "command"], key: "s" }, ctx).errors[0]).toMatch(/repeat/);
    expect(validateProposedAction({ ...base, type: "hotkey", modifiers: [], key: "s" }, ctx).errors[0]).toMatch(/at least one modifier/);
    expect(validateProposedAction({ ...base, type: "wait", ms: 50 }, ctx).errors[0]).toMatch(/between 100 and 15000/);
    expect(validateProposedAction({ ...base, type: "wait", ms: 20_000 }, ctx).ok).toBe(false);
    expect(validateProposedAction({ ...base, type: "click", x: 1, y: 1, button: "left" }, { ...ctx, screenshotWidth: 0 }).ok).toBe(false);
  });
});

describe("validateProposedAction bundle ownership", () => {
  const click = { ...base, type: "click" as const, x: 100, y: 200, button: "left" as const };

  it("rejects a point whose accessibility element belongs to another app", () => {
    const result = validateProposedAction(click, { ...ctx, targetBundleId: "com.apple.TextEdit", hitBundleId: "com.apple.finder" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["target belongs to com.apple.finder"]);
  });

  it("always rejects a hit inside Apprentice's own window", () => {
    expect(validateProposedAction(click, { ...ctx, hitBundleId: APP_BUNDLE_ID }).errors).toEqual([`target belongs to ${APP_BUNDLE_ID}`]);
    expect(validateProposedAction(click, { ...ctx, targetBundleId: APP_BUNDLE_ID, hitBundleId: APP_BUNDLE_ID }).ok).toBe(false);
    expect(foreignHitBundleId({ targetBundleId: APP_BUNDLE_ID, hitBundleId: APP_BUNDLE_ID.toUpperCase() })).toBe(APP_BUNDLE_ID.toUpperCase());
  });

  it("accepts a hit in the target app, ignores unknown hits, and ignores ownership for non-point actions", () => {
    expect(validateProposedAction(click, { ...ctx, targetBundleId: "com.apple.TextEdit", hitBundleId: "com.apple.textedit" }).ok).toBe(true);
    expect(validateProposedAction(click, { ...ctx, targetBundleId: "com.apple.TextEdit", hitBundleId: "" }).ok).toBe(true);
    expect(validateProposedAction(click, { ...ctx, targetBundleId: "com.apple.TextEdit" }).ok).toBe(true);
    expect(validateProposedAction(click, { ...ctx, hitBundleId: "com.apple.finder" }).ok).toBe(true);
    expect(validateProposedAction({ ...base, type: "type_text", text: "hi" }, { ...ctx, targetBundleId: "com.apple.TextEdit", hitBundleId: "com.apple.finder" }).ok).toBe(true);
  });
});

describe("resolveTarget", () => {
  const blocks = [
    { text: "Save", x: 100, y: 100, width: 40, height: 20, confidence: 0.9 },
    { text: "Cancel", x: 200, y: 100, width: 60, height: 20, confidence: 0.9 },
    { text: "Far away", x: 900, y: 700, width: 60, height: 20, confidence: 0.9 }
  ];

  it("finds the nearest OCR label within 40 px", () => {
    const inside = resolveTarget({ point: { x: 110, y: 110 }, ocrBlocks: blocks });
    expect(inside).toMatchObject({ source: "ocr", label: "Save", distancePx: 0, ambiguous: false });
    const near = resolveTarget({ point: { x: 150, y: 110 }, ocrBlocks: blocks });
    expect(near.label).toBe("Save");
    expect(near.distancePx).toBe(10);
    expect(resolveTarget({ point: { x: 500, y: 400 }, ocrBlocks: blocks }).source).toBe("coordinates_only");
  });

  it("flags ambiguity when two different labels are equidistant", () => {
    const result = resolveTarget({ point: { x: 170, y: 110 }, ocrBlocks: blocks });
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toEqual(["Cancel", "Save"]);
    const duplicates = resolveTarget({ point: { x: 170, y: 110 }, ocrBlocks: [blocks[0]!, { ...blocks[1]!, text: "Save" }] });
    expect(duplicates.ambiguous).toBe(false);
  });

  it("falls back to accessibility and coordinates", () => {
    const ax = { role: "AXButton", title: "Log activity", isSecure: false, enabled: true, bounds: { x: 40, y: 70, width: 80, height: 20 } };
    const result = resolveTarget({ point: { x: 100, y: 100 }, axElement: ax, transform });
    expect(result).toMatchObject({ source: "accessibility", label: "Log activity", role: "AXButton", ambiguous: false, distancePx: 35 });
    const far = resolveTarget({ point: { x: 1000, y: 700 }, axElement: ax, transform });
    expect(far.source).toBe("coordinates_only");
    expect(resolveTarget({ point: { x: 1, y: 1 }, axElement: null }).source).toBe("coordinates_only");
    expect(resolveTarget({ point: { x: 1, y: 1 }, axElement: { role: "AXGroup", isSecure: false, enabled: true } }).label).toBeUndefined();
  });

  it("never labels the target from an element owned by another app or by Apprentice", () => {
    const ax = { role: "AXButton", title: "OK", isSecure: false, enabled: true, bounds: { x: 40, y: 70, width: 80, height: 20 } };
    const foreign = resolveTarget({ point: { x: 100, y: 100 }, axElement: ax, transform, targetBundleId: "com.apple.TextEdit", hitBundleId: APP_BUNDLE_ID });
    expect(foreign).toEqual({ source: "coordinates_only", ambiguous: false, candidates: [], foreignBundleId: APP_BUNDLE_ID });
    expect(resolveTarget({ point: { x: 100, y: 100 }, axElement: ax, transform, targetBundleId: "com.apple.TextEdit", hitBundleId: "com.apple.finder" }).foreignBundleId).toBe("com.apple.finder");
    const own = resolveTarget({ point: { x: 100, y: 100 }, axElement: ax, transform, targetBundleId: "com.apple.TextEdit", hitBundleId: "com.apple.TextEdit" });
    expect(own).toMatchObject({ source: "accessibility", label: "OK" });
    expect(own.foreignBundleId).toBeUndefined();
  });
});

describe("toExecutableAction", () => {
  it("maps coordinates into display points", () => {
    expect(toExecutableAction({ ...base, type: "click", x: 640, y: 400, button: "right" }, transform)).toEqual({ type: "click", x: 640, y: 425, button: "right" });
    expect(toExecutableAction({ ...base, type: "double_click", x: 0, y: 0 }, transform)).toEqual({ type: "double_click", x: 0, y: 25 });
    expect(toExecutableAction({ ...base, type: "scroll", x: 10, y: 10, deltaX: 0, deltaY: -3 }, transform)).toEqual({ type: "scroll", x: 10, y: 35, deltaX: 0, deltaY: -3 });
    expect(toExecutableAction({ ...base, type: "move", x: 10, y: 10 }, transform)).toEqual({ type: "move", x: 10, y: 35 });
    expect(toExecutableAction({ ...base, type: "type_text", text: "hi" }, transform)).toEqual({ type: "type_text", text: "hi" });
    expect(toExecutableAction({ ...base, type: "press_key", key: "enter" }, transform)).toEqual({ type: "press_key", key: "enter" });
    expect(toExecutableAction({ ...base, type: "hotkey", modifiers: ["cmd"], key: "s" }, transform)).toEqual({ type: "hotkey", modifiers: ["cmd"], key: "s" });
    expect(toExecutableAction({ ...base, type: "wait", ms: 300 }, transform)).toEqual({ type: "wait", ms: 300 });
    for (const action of [{ ...base, type: "done", summary: "" }, { ...base, type: "fail", reason: "" }, { ...base, type: "ask_user", question: "?" }] as ProposedAction[]) {
      expect(() => toExecutableAction(action, transform)).toThrow(/control action/);
    }
  });
});

describe("completion predicates", () => {
  it("evaluates each predicate kind", () => {
    expect(urlPatternToRegExp("crm.example/contact/:id").test("crm.example/contact/42")).toBe(true);
    expect(urlPatternToRegExp("crm.example/contact/:id").test("crm.example/contact/42/edit")).toBe(false);
    expect(urlPatternToRegExp("mail.example/*").test("https://mail.example/inbox/1")).toBe(true);
    const url = evaluateCompletionPredicates([{ kind: "url_pattern", pattern: "crm.example/contact/:id" }], { domain: "crm.example", path: "/contact/42" });
    expect(url).toEqual({ complete: true, satisfied: ["url_pattern:crm.example/contact/:id"], method: "extension_dom" });
    expect(evaluateCompletionPredicates([{ kind: "url_pattern", pattern: "crm.example/contact/:id" }], { url: "https://crm.example/contact/42?x=1" }).complete).toBe(true);
    expect(evaluateCompletionPredicates([{ kind: "title_contains", text: "saved" }], { windowTitle: "Contact Saved - CRM" })).toMatchObject({ complete: true, method: "accessibility" });
    expect(evaluateCompletionPredicates([{ kind: "ocr_contains", text: "Activity logged" }], { ocrText: "activity LOGGED successfully" }).method).toBe("screen_diff_ocr");
    expect(evaluateCompletionPredicates([{ kind: "app_frontmost", bundleId: "notion.id" }], { frontmostBundleId: "Notion.id" }).method).toBe("app_metadata");
    expect(evaluateCompletionPredicates([{ kind: "dom_marker", marker: "toast-saved" }], { domMarkers: ["toast-saved"] }).method).toBe("extension_dom");
    expect(evaluateCompletionPredicates([{ kind: "user_confirm" }], { userConfirmed: true }).method).toBe("user_confirmation");
    expect(evaluateCompletionPredicates([{ kind: "user_confirm" }], {})).toEqual({ complete: false, satisfied: [], method: "none" });
    expect(evaluateCompletionPredicates([], { userConfirmed: true }).complete).toBe(false);
  });

  it("reports the strongest satisfied method", () => {
    const result = evaluateCompletionPredicates(
      [{ kind: "user_confirm" }, { kind: "title_contains", text: "saved" }, { kind: "dom_marker", marker: "m" }],
      { userConfirmed: true, windowTitle: "Saved", domMarkers: ["m"] }
    );
    expect(result.method).toBe("extension_dom");
    expect(result.satisfied).toHaveLength(3);
  });

  it("hashes state deterministically and ignores whitespace noise", () => {
    expect(stateHash({ ocrText: "a  b", windowTitle: "T" })).toBe(stateHash({ ocrText: "a b", windowTitle: "t" }));
    expect(stateHash({ ocrText: "a" })).not.toBe(stateHash({ ocrText: "b" }));
    expect(stateHash({})).toHaveLength(64);
  });
});

describe("verifyStepDeterministic", () => {
  it("completes a subtask only through predicates or confirmation", () => {
    const verified = verifyStepDeterministic({
      before: { ocrText: "Contact" },
      after: { ocrText: "Contact\nActivity logged", windowTitle: "Saved" },
      expectedResult: "activity is logged",
      predicates: [{ kind: "title_contains", text: "saved" }]
    });
    expect(verified).toMatchObject({ passed: true, subtaskComplete: true, method: "accessibility", confidence: 0.9 });
    const confirmed = verifyStepDeterministic({ before: {}, after: { userConfirmed: true }, expectedResult: "x", predicates: [{ kind: "user_confirm" }] });
    expect(confirmed.confidence).toBe(1);
  });

  it("passes a step on observed OCR change but never completes the subtask", () => {
    const changed = verifyStepDeterministic({
      before: { ocrText: "Contact\nLog activity", screenshotHash: "0000000000000000" },
      after: { ocrText: "Contact\nActivity logged", screenshotHash: "00000000000000ff" },
      expectedResult: "Activity logged confirmation",
      predicates: [{ kind: "user_confirm" }]
    });
    expect(changed.passed).toBe(true);
    expect(changed.subtaskComplete).toBe(false);
    expect(changed.method).toBe("screen_diff_ocr");
    expect(changed.evidence).toMatch(/Added: activity logged/);
    expect(changed.confidence).toBeGreaterThan(0.6);
    expect(ocrDiff("a\nb", "b\nc")).toEqual({ added: ["c"], removed: ["a"] });
  });

  it("fails when nothing changed, even if the model claimed success", () => {
    const same = verifyStepDeterministic({ before: { ocrText: "Contact" }, after: { ocrText: "Contact" }, expectedResult: "Saved", predicates: [] });
    expect(same).toMatchObject({ passed: false, subtaskComplete: false, method: "screen_diff_ocr" });
    const hashOnly = verifyStepDeterministic({ before: { ocrText: "x", screenshotHash: "0000000000000000" }, after: { ocrText: "x", screenshotHash: "ffffffffffffffff" }, expectedResult: "Saved", predicates: [] });
    expect(hashOnly).toMatchObject({ passed: true, subtaskComplete: false, confidence: 0.4 });
  });
});
