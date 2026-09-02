import { describe, expect, it } from "vitest";
import { ActionPolicySchema, type ActionPolicy, type ActionType, type KeyName, type ProposedAction, type RiskClass } from "@apprentice/schemas";
import { classifyRisk } from "./classify.js";
import { LOW_RISK_CLASSES, maxRiskClass, riskClassRank } from "./dictionaries.js";
import { classifyText } from "./match.js";
import { applyPolicy, decidePolicy } from "./policy.js";
import { candidateRiskClass, tokenRiskClass } from "./token-risk.js";

const base = { purpose: "do the thing", expectedResult: "something visible", confidence: 0.8, sourceScreenshot: { width: 1280, height: 800 }, subtaskIndex: 0 };
const click = (): ProposedAction => ({ ...base, type: "click", x: 10, y: 10, button: "left" });
const typing = (text: string): ProposedAction => ({ ...base, type: "type_text", text });
const key = (name: KeyName): ProposedAction => ({ ...base, type: "press_key", key: name });
const hotkey = (modifiers: Array<"cmd" | "shift" | "ctrl" | "alt" | "command">, name: "enter" | "s" | "c" | "delete" | "t" | "z"): ProposedAction => ({ ...base, type: "hotkey", modifiers, key: name });

describe("classifyText and dictionaries", () => {
  it("matches phrases with flexible separators and picks the highest class", () => {
    expect(classifyText("Send message").riskClass).toBe("external_communication");
    expect(classifyText("log_activity").riskClass).toBe("internal_mutation");
    expect(classifyText("Delete forever").riskClass).toBe("destructive");
    expect(classifyText("Pay now").riskClass).toBe("financial_or_access");
    expect(classifyText("Go to dashboard").riskClass).toBe("reversible_navigation");
    expect(classifyText("Save and send").riskClass).toBe("external_communication");
    expect(classifyText("Remove card number").riskClass).toBe("financial_or_access");
    expect(classifyText("lorem ipsum")).toEqual({ riskClass: "unknown", matchedTerms: [], matchedClasses: [] });
    expect(classifyText("Sender").matchedTerms).toEqual([]);
  });

  it("ranks classes", () => {
    const order: RiskClass[] = ["read_only", "reversible_navigation", "internal_mutation", "unknown", "external_communication", "destructive", "financial_or_access", "sensitive_context"];
    order.forEach((riskClass, index) => expect(riskClassRank(riskClass)).toBe(index));
    expect(maxRiskClass(["read_only", "destructive", "internal_mutation"])).toBe("destructive");
    expect(maxRiskClass([])).toBe("read_only");
    expect(LOW_RISK_CLASSES.has("internal_mutation")).toBe(true);
    expect(LOW_RISK_CLASSES.has("external_communication")).toBe(false);
  });

  it("classifies tokens", () => {
    expect(tokenRiskClass("app:x|action:navigate")).toBe("reversible_navigation");
    expect(tokenRiskClass("app:x|action:copy")).toBe("read_only");
    expect(tokenRiskClass("app:x|action:paste")).toBe("internal_mutation");
    expect(tokenRiskClass("app:x|action:shortcut|keys:cmd+enter")).toBe("external_communication");
    expect(tokenRiskClass("app:x|action:shortcut|keys:cmd+delete")).toBe("destructive");
    expect(tokenRiskClass("app:x|action:shortcut|keys:cmd+s")).toBe("internal_mutation");
    expect(tokenRiskClass("app:x|action:form-submit|purpose:message")).toBe("external_communication");
    expect(tokenRiskClass("app:x|action:form-submit|purpose:checkout")).toBe("financial_or_access");
    expect(tokenRiskClass("app:x|action:form-submit|purpose:search")).toBe("read_only");
    expect(tokenRiskClass("app:x|action:click|role:link|name:details")).toBe("reversible_navigation");
    expect(tokenRiskClass("app:x|action:click|name:delete-contact")).toBe("destructive");
    expect(tokenRiskClass("app:x|action:click|name:zzz")).toBe("unknown");
    expect(candidateRiskClass(["app:x|action:click|name:zzz", "app:x|action:copy"])).toBe("read_only");
    expect(candidateRiskClass(["app:x|action:click|name:zzz"])).toBe("unknown");
    expect(candidateRiskClass([])).toBe("unknown");
  });
});

describe("classifyRisk", () => {
  it("sensitive context always aborts", () => {
    const result = classifyRisk({ action: click(), targetLabel: "Next", sensitive: { sensitive: true, reasons: ["ocr:password"] } });
    expect(result.riskClass).toBe("sensitive_context");
    expect(result.decision).toBe("abort");
    expect(result.reasons).toEqual(["sensitive: ocr:password"]);
  });

  it("denied domains and apps are unsupported", () => {
    expect(classifyRisk({ action: click(), domain: "www.paypal.com" })).toMatchObject({ riskClass: "financial_or_access", decision: "unsupported" });
    expect(classifyRisk({ action: click(), bundleId: "com.apple.SystemSettings" }).riskClass).toBe("financial_or_access");
  });

  it("read-only actions", () => {
    for (const action of [
      { ...base, type: "move", x: 1, y: 1 },
      { ...base, type: "scroll", x: 1, y: 1, deltaX: 0, deltaY: 100 },
      { ...base, type: "wait", ms: 500 },
      { ...base, type: "done", summary: "" },
      { ...base, type: "fail", reason: "" },
      { ...base, type: "ask_user", question: "Which contact?" }
    ] as ProposedAction[]) {
      expect(classifyRisk({ action, targetLabel: "Delete everything" }).riskClass).toBe("read_only");
    }
  });

  it("typing is at least internal mutation and escalates on risky text", () => {
    expect(classifyRisk({ action: typing("Follow-up notes") }).riskClass).toBe("internal_mutation");
    expect(classifyRisk({ action: typing("hello"), targetLabel: "Message body" }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: typing("4111 1111"), targetLabel: "Card number" }).riskClass).toBe("financial_or_access");
    expect(classifyRisk({ action: typing("x") }).reasons[0]).toMatch(/exact text must be shown/);
  });

  it("enter and cmd+enter near send terms are external communication", () => {
    expect(classifyRisk({ action: key("enter"), ocrNearTarget: "Send" }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: hotkey(["cmd"], "enter"), targetLabel: "Reply all" }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: hotkey(["command"], "enter"), browserElement: { ariaLabel: "Post comment" } }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: key("enter") }).riskClass).toBe("internal_mutation");
    expect(classifyRisk({ action: key("enter"), ocrNearTarget: "Delete" }).riskClass).toBe("destructive");
    expect(classifyRisk({ action: key("tab") }).riskClass).toBe("read_only");
    expect(classifyRisk({ action: key("a") }).riskClass).toBe("internal_mutation");
  });

  it("classifies shortcuts", () => {
    expect(classifyRisk({ action: hotkey(["cmd"], "s") }).riskClass).toBe("internal_mutation");
    expect(classifyRisk({ action: hotkey(["cmd"], "c") }).riskClass).toBe("read_only");
    expect(classifyRisk({ action: hotkey(["cmd"], "delete") }).riskClass).toBe("destructive");
    expect(classifyRisk({ action: hotkey(["cmd"], "t") }).riskClass).toBe("reversible_navigation");
    expect(classifyRisk({ action: hotkey(["ctrl", "shift"], "z") }).riskClass).toBe("unknown");
  });

  it("classifies clicks from labels, OCR, roles and browser elements", () => {
    expect(classifyRisk({ action: click(), targetLabel: "Send" }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: click(), targetLabel: "Publish post" }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: click(), ocrNearTarget: "Delete contact" }).riskClass).toBe("destructive");
    expect(classifyRisk({ action: click(), targetLabel: "Empty Trash" }).riskClass).toBe("destructive");
    expect(classifyRisk({ action: click(), browserElement: { name: "Buy now" } }).riskClass).toBe("financial_or_access");
    expect(classifyRisk({ action: click(), targetLabel: "Sign in" }).riskClass).toBe("financial_or_access");
    expect(classifyRisk({ action: click(), targetLabel: "Grant access" }).riskClass).toBe("financial_or_access");
    expect(classifyRisk({ action: click(), targetLabel: "Log activity" }).riskClass).toBe("internal_mutation");
    expect(classifyRisk({ action: click(), targetLabel: "Save draft" }).riskClass).toBe("internal_mutation");
    expect(classifyRisk({ action: click(), targetLabel: "Mark complete" }).riskClass).toBe("internal_mutation");
    expect(classifyRisk({ action: click(), targetLabel: "Next" }).riskClass).toBe("reversible_navigation");
    expect(classifyRisk({ action: click(), targetLabel: "Open menu" }).riskClass).toBe("reversible_navigation");
    expect(classifyRisk({ action: click(), axRole: "AXLink", targetLabel: "Q3 report" }).riskClass).toBe("reversible_navigation");
    expect(classifyRisk({ action: click(), browserElement: { role: "tab", text: "Overview" } }).riskClass).toBe("reversible_navigation");
    expect(classifyRisk({ action: click(), targetLabel: "Widget 7" }).riskClass).toBe("unknown");
    expect(classifyRisk({ action: click() })).toMatchObject({ riskClass: "unknown", decision: "approve" });
    expect(classifyRisk({ action: { ...base, type: "double_click", x: 1, y: 1 }, targetLabel: "Delete" }).riskClass).toBe("destructive");
  });

  it("only escalates via the skill risk class, never lowers", () => {
    expect(classifyRisk({ action: click(), targetLabel: "Widget", skillRiskClass: "external_communication" }).riskClass).toBe("external_communication");
    expect(classifyRisk({ action: click(), targetLabel: "Widget", skillRiskClass: "read_only" }).riskClass).toBe("unknown");
    expect(classifyRisk({ action: click(), targetLabel: "Delete", skillRiskClass: "read_only" }).riskClass).toBe("destructive");
    const matched = classifyRisk({ action: click(), targetLabel: "Send invoice" });
    expect(matched.matchedTerms).toContain("send");
    expect(matched.coveredByRunApproval).toBe(false);
  });
});

describe("decidePolicy", () => {
  const policy: ActionPolicy = ActionPolicySchema.parse({ mode: "guide" });
  const noRun = { lowRiskRunApproval: false, navigationRunApproval: false };
  const lowRun = { lowRiskRunApproval: true, navigationRunApproval: false };
  const navRun = { lowRiskRunApproval: true, navigationRunApproval: true };

  it("applies the defaults for every risk class", () => {
    expect(decidePolicy("read_only", "scroll", policy, noRun, false)).toBe("approve");
    expect(decidePolicy("read_only", "scroll", policy, lowRun, false)).toBe("auto");
    expect(decidePolicy("read_only", "scroll", { ...policy, allowLowRiskRunApproval: false }, lowRun, false)).toBe("approve");
    expect(decidePolicy("reversible_navigation", "click", policy, navRun, false)).toBe("approve");
    expect(decidePolicy("reversible_navigation", "click", { ...policy, allowNavigationRunApproval: true }, navRun, false)).toBe("auto");
    expect(decidePolicy("reversible_navigation", "click", { ...policy, allowNavigationRunApproval: true }, lowRun, false)).toBe("approve");
    expect(decidePolicy("internal_mutation", "click", policy, navRun, true)).toBe("approve");
    expect(decidePolicy("external_communication", "click", policy, navRun, true)).toBe("approve");
    expect(decidePolicy("destructive", "click", policy, navRun, true)).toBe("approve_strong");
    expect(decidePolicy("financial_or_access", "click", policy, navRun, true)).toBe("unsupported");
    expect(decidePolicy("sensitive_context", "click", policy, navRun, true)).toBe("abort");
    expect(decidePolicy("unknown", "click", policy, navRun, true)).toBe("approve");
  });

  it("typing always needs approval", () => {
    expect(decidePolicy("read_only", "type_text", policy, lowRun, true)).toBe("approve");
    expect(decidePolicy("internal_mutation", "type_text", { ...policy, mode: "low_risk_auto" }, lowRun, true)).toBe("approve");
  });

  it("suggest_only never executes and low_risk_auto needs the experimental flag", () => {
    const suggest = { ...policy, mode: "suggest_only" as const };
    for (const riskClass of ["read_only", "reversible_navigation", "internal_mutation", "unknown"] as const) {
      expect(decidePolicy(riskClass, "click", suggest, navRun, true)).toBe("approve");
    }
    expect(decidePolicy("destructive", "click", suggest, navRun, true)).toBe("approve_strong");
    const lowAuto = { ...policy, mode: "low_risk_auto" as const };
    expect(decidePolicy("read_only", "scroll", lowAuto, noRun, true)).toBe("auto");
    expect(decidePolicy("read_only", "scroll", lowAuto, noRun, false)).toBe("approve");
    expect(decidePolicy("read_only", "scroll", policy, noRun, true)).toBe("approve");
    expect(decidePolicy("reversible_navigation", "click", lowAuto, noRun, true)).toBe("approve");
    expect(decidePolicy("internal_mutation", "click", lowAuto, noRun, true)).toBe("approve");
  });

  it("covers every mode x class combination without throwing", () => {
    const classes: RiskClass[] = ["read_only", "reversible_navigation", "internal_mutation", "external_communication", "destructive", "financial_or_access", "sensitive_context", "unknown"];
    const modes = ["suggest_only", "guide", "approval_every_step", "low_risk_auto"] as const;
    const types: ActionType[] = ["click", "type_text", "scroll", "hotkey"];
    let decisions = 0;
    for (const mode of modes) for (const riskClass of classes) for (const type of types) {
      const decision = decidePolicy(riskClass, type, { ...policy, mode }, navRun, true);
      expect(["auto", "approve", "approve_strong", "abort", "unsupported"]).toContain(decision);
      if (riskClass === "external_communication" || type === "type_text") expect(decision).not.toBe("auto");
      decisions += 1;
    }
    expect(decisions).toBe(128);
  });

  it("applyPolicy returns a new result with coverage", () => {
    const risk = classifyRisk({ action: { ...base, type: "scroll", x: 1, y: 1, deltaX: 0, deltaY: 10 } });
    const applied = applyPolicy(risk, "scroll", policy, lowRun, false);
    expect(applied.decision).toBe("auto");
    expect(applied.coveredByRunApproval).toBe(true);
    expect(risk.decision).toBe("approve");
    expect(risk.coveredByRunApproval).toBe(false);
  });
});
