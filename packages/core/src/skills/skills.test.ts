import { describe, expect, it } from "vitest";
import { SkillDraftSchema, SkillSchema } from "@apprentice/schemas";
import { discoverCandidates } from "../candidates/discover.js";
import { makeClick, makeEpisode, makeEvent } from "../testing/fixtures.js";
import { draftSkillFromCandidate, draftSkillFromEvents, skillRetentionPreview } from "./draft.js";
import { groupByContext } from "./group.js";
import { anchorEntry, isClosingToken, isOutcomeToken, outcomeEntry } from "./outcome.js";
import { reviseSkill, skillFromDraft } from "./revise.js";

function taughtEvents() {
  return [
    makeEvent({ ts: 0, type: "mouse_down", app: { bundleId: "notion.id" }, element: { role: "AXButton", name: "Meeting notes" } }),
    makeEvent({ ts: 1000, type: "shortcut", app: { bundleId: "notion.id" }, payload: { keys: ["cmd", "c"] } }),
    makeEvent({ ts: 2000, type: "navigation", source: "extension", app: { bundleId: "com.google.Chrome" }, domain: "crm.example", routePattern: "/contact/12345678" }),
    makeEvent({ ts: 2500, type: "page_title", source: "extension", domain: "crm.example", payload: { title: "Contact Alice Johnson - CRM" } }),
    makeClick({ ts: 3000, domain: "crm.example", route: "/contact/12345678", name: "Log activity" }),
    makeEvent({ ts: 4000, type: "paste", source: "extension", app: { bundleId: "com.google.Chrome" }, domain: "crm.example", routePattern: "/contact/12345678" }),
    makeEvent({ ts: 5000, type: "form_submit", source: "extension", app: { bundleId: "com.google.Chrome" }, domain: "crm.example", routePattern: "/contact/12345678", payload: { formPurpose: "update" } }),
    makeEvent({ ts: 6000, type: "navigation", source: "extension", app: { bundleId: "com.google.Chrome" }, domain: "mail.example", routePattern: "/compose" }),
    makeEvent({ ts: 7000, type: "paste", source: "extension", app: { bundleId: "com.google.Chrome" }, domain: "mail.example", routePattern: "/compose" }),
    makeEvent({ ts: 8000, type: "form_submit", source: "extension", app: { bundleId: "com.google.Chrome" }, domain: "mail.example", routePattern: "/compose", payload: { formPurpose: "message" } })
  ];
}

describe("groupByContext", () => {
  const entry = (context: string, index: number) => ({ token: `app:${context}|action:click|name:n${index}`, ts: index, context });

  it("merges tiny groups and bounds the count", () => {
    const entries = [entry("a", 0), entry("a", 1), entry("b", 2), entry("a", 3), entry("a", 4)];
    const groups = groupByContext(entries);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups.every((group) => group.entries.length >= 1)).toBe(true);
    const many = Array.from({ length: 30 }, (_, index) => entry(`c${index % 15}`, index));
    expect(groupByContext(many).length).toBeLessThanOrEqual(12);
    const single = groupByContext([entry("a", 0), entry("a", 1), entry("a", 2), entry("a", 3)]);
    expect(single).toHaveLength(3);
    expect(groupByContext([entry("a", 0)])).toHaveLength(1);
    expect(groupByContext([])).toEqual([]);
  });
});

describe("outcome tokens", () => {
  const entry = (token: string) => ({ token, ts: 0, context: "textedit" });

  it("classifies outcome and closing tokens", () => {
    expect(isOutcomeToken("app:textedit|action:shortcut|keys:cmd+s")).toBe(true);
    expect(isOutcomeToken("app:chrome|domain:crm.example|action:form-submit|purpose:update")).toBe(true);
    expect(isOutcomeToken("app:chrome|action:download|ext:pdf")).toBe(true);
    expect(isOutcomeToken("app:mail|action:click|role:button|name:send-message")).toBe(true);
    expect(isOutcomeToken("app:mail|action:click|role:button|name:compose")).toBe(false);
    expect(isOutcomeToken("app:textedit|action:shortcut|keys:cmd+w")).toBe(false);
    expect(isClosingToken("app:textedit|action:shortcut|keys:cmd+w")).toBe(true);
    expect(isClosingToken("app:textedit|action:shortcut|keys:escape")).toBe(true);
    expect(isClosingToken("app:textedit|action:shortcut|keys:cmd+s")).toBe(false);
  });

  it("anchors on the last outcome, then the last non-closing step, then the last step", () => {
    const save = entry("app:textedit|action:shortcut|keys:cmd+s");
    const close = entry("app:textedit|action:shortcut|keys:cmd+w");
    const open = entry("app:textedit|action:click|name:open");
    expect(anchorEntry([open, save, close])).toBe(save);
    expect(anchorEntry([save, open, close])).toBe(save);
    expect(anchorEntry([open, close])).toBe(open);
    expect(anchorEntry([close])).toBe(close);
    expect(outcomeEntry([open, close])).toBeUndefined();
    expect(() => anchorEntry([])).toThrow(/no entries/);
  });
});

describe("draftSkillFromEvents", () => {
  it("builds a valid deterministic draft with predicates, variables and risk notes", () => {
    const draft = draftSkillFromEvents(taughtEvents(), { name: "Post-meeting follow-up" });
    expect(SkillDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.origin).toBe("deterministic");
    expect(draft.name).toBe("Post-meeting follow-up");
    expect(draft.subtasks.length).toBeGreaterThanOrEqual(3);
    expect(draft.subtasks.length).toBeLessThanOrEqual(12);
    expect(draft.subtasks.map((subtask) => subtask.appOrDomain)).toEqual(["notion", "crm.example", "mail.example"]);
    expect(draft.subtasks[0]!.keySteps).toEqual(["Click the 'Meeting notes' button", "Press Cmd+C"]);
    // The notion group ends with a switch to Chrome, so it completes on that app coming forward.
    expect(draft.subtasks[0]!.completionPredicates).toEqual([{ kind: "app_frontmost", bundleId: "com.google.Chrome" }]);
    expect(draft.subtasks[1]!.completionPredicates).toEqual([{ kind: "title_contains", text: "Contact [name] - CRM" }]);
    expect(draft.subtasks[2]!.completionCriteria).toMatch(/Submit the message form has visibly succeeded on mail.example/);
    expect(draft.variables.map((variable) => variable.name)).toContain("contact_id");
    expect(draft.successCriteria).toContain("Submit the message form completed on mail.example");
    expect(draft.riskNotes[0]).toMatch(/external_communication/);
    expect(draft.allowedDomains).toEqual(["crm.example", "mail.example"]);
    expect(draft.allowedApps).toEqual(["notion.id", "com.google.Chrome"]);
    expect(draft.trigger).toBe("When you click the 'meeting notes' button on notion");
    expect(() => draftSkillFromEvents([makeEvent({ ts: 0, type: "idle_changed" })])).toThrow(/no action events/);
  });

  it("uses url predicates for navigation-ending groups", () => {
    const events = [
      makeClick({ ts: 0, domain: "crm.example", name: "Contacts" }),
      makeClick({ ts: 1000, domain: "crm.example", name: "Filter" }),
      makeEvent({ ts: 2000, type: "navigation", source: "extension", domain: "crm.example", routePattern: "/contacts/42" }),
      makeClick({ ts: 3000, domain: "mail.example", name: "Compose" }),
      makeClick({ ts: 4000, domain: "mail.example", name: "Send" }),
      makeEvent({ ts: 5000, type: "navigation", source: "extension", domain: "mail.example", routePattern: "/inbox" })
    ];
    const draft = draftSkillFromEvents(events);
    const last = draft.subtasks[draft.subtasks.length - 1]!;
    expect(last.completionPredicates).toEqual([{ kind: "url_pattern", pattern: "mail.example/inbox" }]);
    expect(draft.name).toBe("mail.example: Click the 'Send' button");
    expect(draft.goal).toBe("Click the 'Send' button has visibly succeeded on mail.example");
  });

  it("takes the title predicate from after the last action and keeps only the part that changed", () => {
    const app = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
    const events = [
      makeEvent({ ts: 0, type: "window_title_changed", app, payload: { title: "Untitled - TextEdit" } }),
      makeEvent({ ts: 1000, type: "mouse_down", app, element: { role: "AXButton", name: "Body" } }),
      makeEvent({ ts: 2000, type: "shortcut", app, payload: { keys: ["cmd", "s"] } }),
      // The save renames the window 3 s after the last action: inside the outcome tail window.
      makeEvent({ ts: 5000, type: "window_title_changed", app, payload: { title: "Report Q3 - TextEdit" } })
    ];
    const last = draftSkillFromEvents(events).subtasks.at(-1)!;
    expect(last.completionPredicates).toEqual([{ kind: "title_contains", text: "Report Q3" }]);
  });

  it("ignores a title that only appears once the next subtask has started", () => {
    const notion = { bundleId: "notion.id", name: "Notion" };
    const events = [
      makeEvent({ ts: 0, type: "mouse_down", app: notion, element: { role: "AXButton", name: "Notes" } }),
      makeEvent({ ts: 1000, type: "shortcut", app: notion, payload: { keys: ["cmd", "c"] } }),
      makeClick({ ts: 2000, domain: "crm.example", name: "Contacts" }),
      makeEvent({ ts: 2500, type: "page_title", source: "extension", domain: "crm.example", payload: { title: "Contacts - CRM" } }),
      makeClick({ ts: 3000, domain: "crm.example", name: "Log activity" }),
      makeClick({ ts: 4000, domain: "crm.example", name: "Save" })
    ];
    const draft = draftSkillFromEvents(events);
    // The Notion subtask must not borrow the CRM title that appeared after the switch.
    expect(draft.subtasks[0]!.completionPredicates).toEqual([{ kind: "app_frontmost", bundleId: "com.google.Chrome" }]);
  });

  it("falls back to user_confirm when nothing observable ends the subtask", () => {
    const app = { bundleId: "com.apple.finder", name: "Finder" };
    const events = [
      makeEvent({ ts: 0, type: "mouse_down", app, element: { role: "AXButton", name: "Documents" } }),
      makeEvent({ ts: 1000, type: "mouse_down", app, element: { role: "AXButton", name: "Downloads" } }),
      makeEvent({ ts: 2000, type: "mouse_down", app, element: { role: "AXButton", name: "Desktop" } })
    ];
    const draft = draftSkillFromEvents(events);
    expect(draft.subtasks.every((subtask) => subtask.completionPredicates[0]!.kind === "user_confirm")).toBe(true);
  });

  it("names and describes the goal from the last strong outcome, not a closing shortcut", () => {
    const app = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
    const events = [
      makeEvent({ ts: 0, type: "mouse_down", app, element: { role: "AXMenuItem", name: "New Document" } }),
      makeEvent({ ts: 1000, type: "shortcut", app, payload: { keys: ["cmd", "s"] } }),
      makeEvent({ ts: 2000, type: "shortcut", app, payload: { keys: ["cmd", "w"] } }),
      makeEvent({ ts: 3000, type: "shortcut", app, payload: { keys: ["cmd", "q"] } })
    ];
    const draft = draftSkillFromEvents(events);
    expect(SkillDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.name).toBe("textedit: Press Cmd+S");
    expect(draft.goal).toBe("Press Cmd+S has visibly succeeded on textedit");
    expect(draft.successCriteria).toEqual(["Press Cmd+S completed on textedit"]);
    expect(draft.subtasks.flatMap((subtask) => subtask.keySteps)).toEqual(["Click the 'New document' menuitem", "Press Cmd+S", "Press Cmd+W", "Press Cmd+Q"]);
  });

  it("falls back to a Work in name and goal when nothing in the range is an outcome", () => {
    const app = { bundleId: "com.apple.finder" };
    const events = [
      makeEvent({ ts: 0, type: "mouse_down", app, element: { role: "AXButton", name: "Documents" } }),
      makeEvent({ ts: 1000, type: "shortcut", app, payload: { keys: ["cmd", "n"] } }),
      makeEvent({ ts: 2000, type: "shortcut", app, payload: { keys: ["cmd", "w"] } })
    ];
    const draft = draftSkillFromEvents(events);
    expect(SkillDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.name).toBe("Work in finder");
    expect(draft.goal).toBe("Work in finder until the recorded steps are complete");
    expect(draft.successCriteria).toEqual([]);
  });

  it("drafts from candidates", () => {
    const DAY = 86_400_000;
    const tokens = ["app:notion|action:click|name:meeting-notes", "app:notion|action:copy", "app:chrome|domain:crm.example|route:/contact/:id|action:navigate", "app:chrome|domain:crm.example|route:/contact/:id|action:paste", "app:chrome|domain:crm.example|route:/contact/:id|action:form-submit|purpose:update"];
    const episodes = [0, 1].map((day) => makeEpisode({ id: `e${day}`, actionTokens: tokens, startTs: day * DAY, endTs: day * DAY + 200_000, activeDurationMs: 200_000, meaningfulActionCount: 5 }));
    const [candidate] = discoverCandidates(episodes, { now: 3 * DAY });
    const draft = draftSkillFromCandidate(candidate!, episodes);
    expect(SkillDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.name).toBe(candidate!.deterministicTitle);
    expect(draft.subtasks.length).toBeGreaterThanOrEqual(3);
    expect(draft.variables.map((variable) => variable.name)).toContain("contact_id");
    expect(draft.confidence).toBe(candidate!.confidence);
    expect(() => draftSkillFromCandidate({ ...candidate!, steps: [] }, episodes)).toThrow();
    // Without evidence events a candidate subtask can only be confirmed by the user.
    expect(draft.subtasks.every((subtask) => subtask.completionPredicates[0]!.kind === "user_confirm")).toBe(true);

    const evidenceEvents = [
      makeEvent({ ts: 0, type: "mouse_down", app: { bundleId: "notion.id", name: "Notion" }, element: { role: "AXButton", name: "Meeting notes" } }),
      makeEvent({ ts: 1000, type: "page_title", source: "extension", app: { bundleId: "com.google.Chrome", name: "Google Chrome" }, domain: "crm.example", payload: { title: "Contact Alice Johnson - CRM" } })
    ];
    const withEvidence = draftSkillFromCandidate(candidate!, episodes, evidenceEvents);
    expect(withEvidence.subtasks[0]!.completionPredicates).toEqual([{ kind: "app_frontmost", bundleId: "com.google.Chrome" }]);
    expect(withEvidence.subtasks.at(-1)!.completionPredicates).toContainEqual({ kind: "title_contains", text: "Contact [name] - CRM" });
  });
});

describe("skillFromDraft and reviseSkill", () => {
  const draft = draftSkillFromEvents(taughtEvents(), { name: "Follow-up" });
  const skill = skillFromDraft(draft, { id: "skill_1", source: "taught", evidence: { episodeIds: ["ep1"] }, mode: "guide", now: 1000 });

  it("creates a valid version-1 skill with defaults", () => {
    expect(SkillSchema.safeParse(skill).success).toBe(true);
    expect(skill.version).toBe(1);
    expect(skill.policy).toEqual({ mode: "guide", allowLowRiskRunApproval: true, allowNavigationRunApproval: false, requireTypingApproval: true, neverAutoSend: true });
    expect(skill.riskClass).toBe("external_communication");
    expect(skill.subtasks[0]!.id).toBe("skill_1_st1");
    expect(skill.subtasks[1]!.completionPredicates[0]!.kind).toBe("title_contains");
    expect(skill.createdAt).toBe(1000);
    expect(skill.corrections).toEqual([]);
    const plain = skillFromDraft(SkillDraftSchema.parse(draft), { source: "taught", evidence: { episodeIds: [] }, mode: "suggest_only" });
    expect(plain.subtasks.every((subtask) => subtask.completionPredicates[0]!.kind === "user_confirm")).toBe(true);
    expect(plain.id.startsWith("skill_")).toBe(true);
  });

  it("revises immutably with version bumps and correction entries", () => {
    const revised = reviseSkill(skill, { name: "Follow-up v2", trigger: "After a meeting", version: 99 }, "Renamed", 2000);
    expect(revised.version).toBe(2);
    expect(revised.name).toBe("Follow-up v2");
    expect(revised.trigger).toBe("After a meeting");
    expect(revised.corrections).toEqual([
      { ts: 2000, field: "name", note: "Renamed", fromVersion: 1 },
      { ts: 2000, field: "trigger", note: "Renamed", fromVersion: 1 }
    ]);
    expect(revised.updatedAt).toBe(2000);
    expect(skill.version).toBe(1);
    expect(skill.name).toBe("Follow-up");
    expect(skill.corrections).toEqual([]);
    const third = reviseSkill(revised, { archived: true }, "Archived", 3000);
    expect(third.version).toBe(3);
    expect(third.corrections).toHaveLength(3);
    expect(third.corrections[2]!.fromVersion).toBe(2);
    expect(() => reviseSkill(skill, { name: "Follow-up" }, "no-op")).toThrow(/no effective changes/);
  });

  it("previews exactly what would be retained", () => {
    const events = taughtEvents();
    const preview = skillRetentionPreview(draft, events, [{ id: "shot1", ts: 0, sessionId: "s", width: 10, height: 10, displayScale: 2, perceptualHash: "0", byteLength: 1, reason: "teach_marker", analyzed: false }]);
    expect(preview.eventCount).toBe(events.length);
    expect(preview.screenshotCount).toBe(1);
    expect(preview.fields).toContain("event.element.label");
    expect(preview.fields).toContain("event.payload.title");
    expect(preview.fields).toContain("screenshot.encryptedPng");
    expect(preview.fields).toContain("skill.variables");
    expect(skillRetentionPreview(draft, [], []).fields).not.toContain("screenshot.encryptedPng");
  });
});
