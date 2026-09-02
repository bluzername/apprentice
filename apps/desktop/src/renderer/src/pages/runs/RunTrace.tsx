import type { JSX } from "react";
import type { RunStep } from "@apprentice/schemas";
import { Badge, RiskBadge } from "../../components/Badge";
import { describeAction } from "../../lib/annotation";
import { failureLabel, formatDuration, formatPercent, formatTimeWithSeconds, humanize } from "../../lib/format";
import { TypedTextPreview } from "./TypedTextPreview";

function approvalTone(decision: string): "success" | "danger" | "warning" | "neutral" {
  if (decision === "approved" || decision === "auto") return "success";
  if (decision === "rejected") return "danger";
  if (decision === "timed_out" || decision === "interrupted") return "warning";
  return "neutral";
}

function validationText(step: RunStep): string {
  const v = step.validation;
  if (!v) return "Not validated";
  if (!v.ok) return `Failed: ${v.errors.join("; ")}`;
  const target = v.resolvedTarget ? ` (${v.resolvedTarget.source}${v.resolvedTarget.label ? `: ${v.resolvedTarget.label}` : ""})` : "";
  const drift = v.targetDriftPx !== undefined ? `, drift ${Math.round(v.targetDriftPx)} px` : "";
  return `OK${target}${drift}`;
}

export function RunTrace({ steps }: { steps: ReadonlyArray<RunStep> }): JSX.Element {
  if (steps.length === 0) return <p className="muted">No steps yet.</p>;
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Step-by-step trace">
      {steps.map((step) => (
        <li key={step.id} className="trace-step">
          <div className="trace-index" aria-hidden="true">{step.index + 1}</div>
          <div>
            <div className="row">
              <strong>{step.proposed ? describeAction(step.proposed) : step.controlToken ? `Control: ${step.controlToken}` : "No action proposed"}</strong>
              {step.risk ? <RiskBadge risk={step.risk.riskClass} /> : null}
              {step.failureCategory !== "none" ? <Badge tone="danger">{failureLabel(step.failureCategory)}</Badge> : null}
              {step.userInterrupted ? <Badge tone="warning">Interrupted</Badge> : null}
              <span className="small muted">{formatTimeWithSeconds(step.ts)}, subtask {step.subtaskIndex + 1}</span>
            </div>
            {step.actionSummary ? <div className="small">{step.actionSummary}</div> : null}
            {step.proposed?.type === "type_text" ? (
              <div style={{ marginTop: 4 }}>
                <TypedTextPreview text={step.proposed.text} id={`typed-${step.id}`} small />
              </div>
            ) : null}
            <div className="trace-grid">
              <div>
                <strong>Risk reasons</strong>
                {step.risk ? step.risk.reasons.join("; ") || "None" : "Not classified"}
              </div>
              <div>
                <strong>Validation</strong>
                {validationText(step)}
              </div>
              <div>
                <strong>Approval</strong>
                {step.approval ? (
                  <Badge tone={approvalTone(step.approval.decision)}>
                    {humanize(step.approval.decision)}
                    {step.approval.scope === "run_low_risk" ? " (run low-risk)" : ""}
                  </Badge>
                ) : (
                  "Pending"
                )}
              </div>
              <div>
                <strong>Executed</strong>
                {step.executed ? `${humanize(step.executed.type)}${"x" in step.executed ? ` at ${Math.round(step.executed.x)}, ${Math.round(step.executed.y)} pt` : ""}` : "Not executed"}
              </div>
              <div>
                <strong>Verification</strong>
                {step.verification ? `${step.verification.passed ? "Passed" : "Failed"} via ${humanize(step.verification.method)} (${formatPercent(step.verification.confidence)})${step.verification.subtaskComplete ? ", subtask complete" : ""}` : "Not verified"}
                {step.verification?.evidence ? <div className="muted">{step.verification.evidence}</div> : null}
              </div>
              <div>
                <strong>Timing</strong>
                total {formatDuration(step.timing.totalMs)}: capture {step.timing.captureMs} ms, propose {step.timing.proposeMs} ms, wait {formatDuration(step.timing.approvalWaitMs)}, execute {step.timing.executeMs} ms, verify {step.timing.verifyMs} ms
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
