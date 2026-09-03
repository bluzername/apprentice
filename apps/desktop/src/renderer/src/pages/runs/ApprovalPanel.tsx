import { useEffect, useRef, useState, type JSX } from "react";
import type { ApprovalRequest } from "@apprentice/schemas";
import { Badge, RiskBadge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { actionTarget, describeAction, hotkeyLabel, keyLabel, markerPosition, markerRadius } from "../../lib/annotation";
import { formatPercent, humanize } from "../../lib/format";
import { TypedTextPreview } from "./TypedTextPreview";

interface ApprovalPanelProps {
  request: ApprovalRequest;
  busy: boolean;
  onDecide: (decision: "approved" | "rejected", scope: "once" | "run_low_risk") => void;
}

/**
 * Shows exactly what will happen, annotated on the screenshot, before anything
 * executes. Announcements are handled by the run page's status region.
 */
export function ApprovalPanel({ request, busy, onDecide }: ApprovalPanelProps): JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null);
  const [displayed, setDisplayed] = useState({ width: 0, height: 0 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const update = (): void => {
      setDisplayed({ width: img.clientWidth, height: img.clientHeight });
      setImageOffset({ x: img.offsetLeft, y: img.offsetTop });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(img);
    return () => observer.disconnect();
  }, [request.stepId]);

  const natural = { width: request.screenshotWidth, height: request.screenshotHeight };
  const target = request.target ?? actionTarget(request.proposed);
  const targetLabel = request.target?.label;
  const marker = target ? markerPosition(target, natural, displayed, imageOffset) : null;
  const radius = markerRadius(displayed.width);
  const action = request.proposed;

  return (
    <section className="approval-panel" aria-labelledby="approval-title">
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
        <div style={{ marginTop: 12 }}>
          <TypedTextPreview text={action.text} id="approval-typed-text" />
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
          <Badge tone={request.risk.decision === "approve_strong" ? "warning" : "neutral"}>{humanize(request.risk.decision)}</Badge>
        </dd>
      </dl>
      <div className="approval-actions">
        <Button variant="primary" busy={busy} onClick={() => onDecide("approved", "once")}>
          Approve once
        </Button>
        {request.canApproveRunLowRisk ? (
          <Button busy={busy} onClick={() => onDecide("approved", "run_low_risk")} aria-describedby="approval-low-risk-hint">
            Approve low-risk for this run
          </Button>
        ) : null}
        <Button variant="danger" busy={busy} onClick={() => onDecide("rejected", "once")}>
          Reject
        </Button>
      </div>
      {request.canApproveRunLowRisk ? (
        <p className="field-hint" id="approval-low-risk-hint" style={{ marginTop: 6 }}>
          Low-risk covers read-only and scroll actions for the rest of this run. Typing and sending still ask.
        </p>
      ) : null}
    </section>
  );
}
