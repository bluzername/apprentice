import { useEffect, useRef, useState, type JSX } from "react";
import type { ApprovalRequest } from "@apprentice/schemas";
import { Badge, RiskBadge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { actionTarget, describeAction, hotkeyLabel, keyLabel, markerRadius, scalePoint } from "../../lib/annotation";
import { formatPercent } from "../../lib/format";

interface ApprovalPanelProps {
  request: ApprovalRequest;
  busy: boolean;
  onDecide: (decision: "approved" | "rejected", scope: "once" | "run_low_risk") => void;
}

/** Shows exactly what will happen, annotated on the screenshot, before anything executes. */
export function ApprovalPanel({ request, busy, onDecide }: ApprovalPanelProps): JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null);
  const [displayed, setDisplayed] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const update = (): void => setDisplayed({ width: img.clientWidth, height: img.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(img);
    return () => observer.disconnect();
  }, [request.stepId]);

  const natural = { width: request.screenshotWidth, height: request.screenshotHeight };
  const target = request.target ?? actionTarget(request.proposed);
  const targetLabel = request.target?.label;
  const marker = target ? scalePoint(target, natural, displayed) : null;
  const radius = markerRadius(displayed.width);
  const action = request.proposed;

  return (
    <section className="approval-panel" aria-labelledby="approval-title" aria-live="assertive">
      <div className="row-between">
        <h3 id="approval-title">Approval needed: step {request.stepIndex + 1}, {request.subtaskTitle}</h3>
        <RiskBadge risk={request.risk.riskClass} />
      </div>
      <p style={{ marginTop: 6 }}>
        <strong>{describeAction(action)}</strong>
        {targetLabel ? <span className="muted"> on {targetLabel}</span> : null}
      </p>
      <div className="approval-shot">
        <img ref={imgRef} src={`data:image/png;base64,${request.screenshotPngBase64}`} alt={`Screenshot of the current screen. ${target ? `Target at ${Math.round(target.x)}, ${Math.round(target.y)} pixels.` : "No pointer target."}`} />
        {marker && displayed.width > 0 ? <div className="approval-marker" style={{ left: marker.x, top: marker.y, width: radius * 2, height: radius * 2 }} aria-hidden="true" /> : null}
      </div>
      {action.type === "type_text" ? (
        <div className="field" style={{ marginTop: 12 }}>
          <span className="field-label">Exact text that will be typed</span>
          <div className="typed-text" aria-label="Text to type">{action.text}</div>
        </div>
      ) : null}
      {action.type === "hotkey" ? (
        <p style={{ marginTop: 12 }}>
          Keys: <kbd>{hotkeyLabel(action.modifiers, action.key)}</kbd>
        </p>
      ) : null}
      {action.type === "press_key" ? (
        <p style={{ marginTop: 12 }}>
          Key: <kbd>{keyLabel(action.key)}</kbd>
        </p>
      ) : null}
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Purpose</dt>
        <dd>{action.purpose}</dd>
        <dt>Expected result</dt>
        <dd>{action.expectedResult}</dd>
        <dt>Model confidence</dt>
        <dd>{formatPercent(action.confidence)}</dd>
        <dt>Risk reasons</dt>
        <dd>
          {request.risk.reasons.length > 0 ? request.risk.reasons.join("; ") : "None recorded"}
          {request.risk.matchedTerms.length > 0 ? <span className="muted"> (matched: {request.risk.matchedTerms.join(", ")})</span> : null}
        </dd>
        <dt>Policy decision</dt>
        <dd>
          <Badge tone={request.risk.decision === "approve_strong" ? "warning" : "neutral"}>{request.risk.decision.replace("_", " ")}</Badge>
        </dd>
      </dl>
      <div className="approval-actions">
        <Button variant="primary" busy={busy} onClick={() => onDecide("approved", "once")}>
          Approve once
        </Button>
        {request.canApproveRunLowRisk ? (
          <Button busy={busy} onClick={() => onDecide("approved", "run_low_risk")} title="Read-only and scroll actions continue without asking for the rest of this run">
            Approve low-risk for this run
          </Button>
        ) : null}
        <Button variant="danger" busy={busy} onClick={() => onDecide("rejected", "once")}>
          Reject
        </Button>
      </div>
    </section>
  );
}
