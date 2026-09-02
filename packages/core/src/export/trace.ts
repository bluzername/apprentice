import type { ActionValidation, ExecutableAction, ProposedAction, Run, RunStep, StepVerification } from "@apprentice/schemas";

function redactedText(text: string): string {
  return `[redacted len=${text.length}]`;
}

function redactProposed(action: ProposedAction | null): ProposedAction | null {
  if (action === null) return null;
  if (action.type === "type_text") return { ...action, text: redactedText(action.text) };
  return { ...action };
}

function redactExecuted(action: ExecutableAction | null): ExecutableAction | null {
  if (action === null) return null;
  if (action.type === "type_text") return { ...action, text: redactedText(action.text) };
  return { ...action };
}

function redactValidation(validation: ActionValidation | null): ActionValidation | null {
  if (validation === null) return null;
  const { resolvedTarget, ...rest } = validation;
  return resolvedTarget === undefined ? { ...rest } : { ...rest, resolvedTarget: { source: resolvedTarget.source, role: resolvedTarget.role } };
}

function redactVerification(verification: StepVerification | null): StepVerification | null {
  if (verification === null) return null;
  return { ...verification, evidence: redactedText(verification.evidence) };
}

export interface RedactedRunTrace {
  readonly run: Run;
  readonly steps: readonly RunStep[];
  readonly redactedFields: readonly string[];
}

/** Diagnostics-safe copy: no typed text, screenshot refs, OCR evidence, or resolved labels. */
export function redactRunTraceForExport(run: Run, steps: readonly RunStep[]): RedactedRunTrace {
  const redactedSteps = steps.map((step) => {
    const { screenshotRef: _screenshotRef, semanticStateRef: _semanticStateRef, ...rest } = step;
    return {
      ...rest,
      proposed: redactProposed(step.proposed),
      executed: redactExecuted(step.executed),
      validation: redactValidation(step.validation),
      verification: redactVerification(step.verification)
    };
  });
  return {
    run: { ...run, summary: run.summary.length > 0 ? redactedText(run.summary) : "" },
    steps: redactedSteps,
    redactedFields: ["steps[].screenshotRef", "steps[].semanticStateRef", "steps[].proposed.text", "steps[].executed.text", "steps[].validation.resolvedTarget.label", "steps[].verification.evidence", "run.summary"]
  };
}
