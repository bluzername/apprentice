import type { JSX } from "react";
import type { CandidateUserAction, WorkflowCandidate } from "@apprentice/schemas";
import { Badge, RiskBadge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { formatDuration, formatMinutes, formatPercent, humanize } from "../../lib/format";
import { buildHash } from "../../lib/router";

export const CANDIDATE_ACTIONS: ReadonlyArray<{ action: CandidateUserAction; label: string; primary?: boolean; rejection?: boolean }> = [
  { action: "try_once", label: "Try once", primary: true },
  { action: "edit_and_save", label: "Edit and save" },
  { action: "not_useful", label: "Not useful", rejection: true },
  { action: "wrong_boundaries", label: "Wrong boundaries", rejection: true },
  { action: "private_workflow", label: "Private workflow", rejection: true },
  { action: "already_automated", label: "Already automated", rejection: true },
  { action: "never_learn", label: "Never learn this pattern", rejection: true }
];

export function candidateTitle(c: WorkflowCandidate): string {
  return c.refinedTitle ?? c.deterministicTitle;
}

export function observedLabel(count: number): string {
  return count === 1 ? "Observed once" : `Observed ${count} times`;
}

interface CandidateCardProps {
  candidate: WorkflowCandidate;
  detailed?: boolean;
  busyAction?: CandidateUserAction | null;
  onAction: (action: CandidateUserAction) => void;
}

/** Evidence-centred candidate card. Precise language only. */
export function CandidateCard({ candidate, detailed = false, busyAction = null, onAction }: CandidateCardProps): JSX.Element {
  const suppressed = candidate.suppression.state !== "active";
  return (
    <Card as="article" className="candidate-card" aria-labelledby={`cand-${candidate.id}`}>
      <div className="card-header">
        <div>
          <h3 id={`cand-${candidate.id}`}>{candidateTitle(candidate)}</h3>
          <div className="row small">
            <Badge tone="accent">{observedLabel(candidate.repeatCount)}</Badge>
            <RiskBadge risk={candidate.riskClass} />
            {candidate.source === "taught" ? <Badge tone="neutral">Taught</Badge> : null}
            {suppressed ? <Badge tone="warning">{humanize(candidate.suppression.state)}</Badge> : null}
          </div>
        </div>
        {!detailed ? <a href={buildHash("candidates", candidate.id)}>Evidence</a> : null}
      </div>
      {candidate.refinedDescription ? <p>{candidate.refinedDescription}</p> : null}
      <div className="chips" style={{ marginBottom: 10 }}>
        {[...candidate.apps, ...candidate.domains].map((x) => (
          <span key={x} className="chip">
            {x}
          </span>
        ))}
      </div>
      <dl className="kv">
        <dt>Typical trigger</dt>
        <dd>{candidate.trigger}</dd>
        <dt>Expected outcome</dt>
        <dd>{candidate.expectedOutcome}</dd>
        <dt>Median duration</dt>
        <dd>
          {formatDuration(candidate.medianDurationMs)}, about {formatMinutes(candidate.estimatedWeeklyMinutes)} per week ({Math.round(candidate.estimatedWeeklyFrequency * 10) / 10} times)
        </dd>
        <dt>Confidence</dt>
        <dd>
          <div className="row">
            <div className="confidence-bar" style={{ width: 120 }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(candidate.confidence * 100)} aria-label="Confidence">
              <span style={{ width: formatPercent(candidate.confidence) }} />
            </div>
            <span>{formatPercent(candidate.confidence)}</span>
          </div>
          <div className="small muted">{candidate.confidenceExplanation}</div>
        </dd>
      </dl>
      <h4 style={{ margin: "12px 0 4px" }}>Steps</h4>
      <ol className="steps-list">
        {candidate.steps.map((s) => (
          <li key={s.index}>
            {s.description}
            {s.appOrDomain ? <span className="muted small"> in {s.appOrDomain}</span> : null}
            {s.occurrenceRatio < 1 ? <span className="muted small"> (seen in {formatPercent(s.occurrenceRatio)} of occurrences)</span> : null}
          </li>
        ))}
      </ol>
      {candidate.variables.length > 0 ? (
        <>
          <h4 style={{ margin: "12px 0 4px" }}>Variables that changed between occurrences</h4>
          <ul>
            {candidate.variables.map((v) => (
              <li key={v.name}>
                <code>{v.name}</code> ({humanize(v.kind)}){v.description ? `: ${v.description}` : ""}
                {v.examples.length > 0 ? <span className="muted small"> e.g. {v.examples.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="candidate-actions">
        {CANDIDATE_ACTIONS.map((a) => (
          <Button key={a.action} size="sm" variant={a.primary ? "primary" : "default"} busy={busyAction === a.action} disabled={busyAction !== null || (suppressed && a.rejection)} onClick={() => onAction(a.action)}>
            {a.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
