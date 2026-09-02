import type { ActionPolicy, ActionType, PolicyDecision, RiskClass, RiskResult } from "@apprentice/schemas";

export interface RunApprovals {
  readonly lowRiskRunApproval: boolean;
  readonly navigationRunApproval: boolean;
}

/**
 * Policy defaults from the spec. Typing and external communication are never
 * automatic; financial, access, and sensitive contexts are unsupported.
 */
export function decidePolicy(
  risk: RiskClass,
  actionType: ActionType,
  policy: ActionPolicy,
  run: RunApprovals,
  experimentalLowRiskAuto: boolean
): PolicyDecision {
  if (risk === "sensitive_context") return "abort";
  if (risk === "financial_or_access") return "unsupported";
  if (risk === "destructive") return "approve_strong";
  if (policy.mode === "suggest_only") return "approve";
  if (actionType === "type_text") return "approve";
  if (risk === "read_only") {
    if (run.lowRiskRunApproval && policy.allowLowRiskRunApproval) return "auto";
    if (experimentalLowRiskAuto && policy.mode === "low_risk_auto") return "auto";
    return "approve";
  }
  if (risk === "reversible_navigation") {
    return run.navigationRunApproval && policy.allowNavigationRunApproval ? "auto" : "approve";
  }
  return "approve";
}

/** Returns a new RiskResult with the policy decision applied. */
export function applyPolicy(
  risk: RiskResult,
  actionType: ActionType,
  policy: ActionPolicy,
  run: RunApprovals,
  experimentalLowRiskAuto: boolean
): RiskResult {
  const decision = decidePolicy(risk.riskClass, actionType, policy, run, experimentalLowRiskAuto);
  const coveredByRunApproval =
    decision === "auto" &&
    ((risk.riskClass === "read_only" && run.lowRiskRunApproval) ||
      (risk.riskClass === "reversible_navigation" && run.navigationRunApproval));
  return { ...risk, decision, coveredByRunApproval };
}

export const DEFAULT_ACTION_POLICY: ActionPolicy = {
  mode: "guide",
  allowLowRiskRunApproval: true,
  allowNavigationRunApproval: false,
  requireTypingApproval: true,
  neverAutoSend: true
};
