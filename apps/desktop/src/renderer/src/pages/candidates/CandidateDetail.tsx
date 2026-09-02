import { useCallback, useState, type JSX } from "react";
import type { CandidateUserAction } from "@apprentice/schemas";
import { Badge } from "../../components/Badge";
import { Card } from "../../components/Card";
import { CardSkeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/States";
import { Timeline, type TimelineGroup } from "../../components/Timeline";
import { invoke } from "../../lib/api";
import { formatDate, formatDuration, formatTime, humanize } from "../../lib/format";
import { useLoader } from "../../lib/hooks";
import { buildHash } from "../../lib/router";
import { EventBody } from "../activity/EventBody";
import { CandidateCard } from "./CandidateCard";
import { CandidateFeedbackForm } from "./CandidateFeedbackForm";
import { useCandidateActions } from "./useCandidateActions";

export function CandidateDetail({ id }: { id: string }): JSX.Element {
  const loader = useCallback(() => invoke("candidates:get", { id }), [id]);
  const { data, error, loading, reload, setData } = useLoader(loader);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const { act, busyAction } = useCandidateActions({
    onUpdated: (candidate) => setData((current) => (current ? { ...current, candidate } : current)),
    onRejected: (candidateId) => setFeedbackFor(candidateId)
  });

  if (error) return <ErrorState title="Could not load candidate" message={error} onRetry={reload} />;
  if (loading || !data) return <CardSkeleton count={2} />;

  const groups: TimelineGroup[] = data.evidence.map(({ episode, events }, i) => ({
    key: episode.id,
    title: `Occurrence ${i + 1}: ${formatDate(episode.startTs)} ${formatTime(episode.startTs)} to ${formatTime(episode.endTs)} (${formatDuration(episode.activeDurationMs)} active)`,
    entries: events.map((e) => ({
      id: e.id,
      ts: e.ts,
      ...(e.type === "privacy_gap" ? { gap: "Not captured: app outside your allowlist" } : { body: <EventBody event={e} /> })
    }))
  }));

  return (
    <div className="page">
      <a href={buildHash("candidates")}>Back to candidates</a>
      <CandidateCard candidate={data.candidate} detailed busyAction={busyAction} onAction={(action: CandidateUserAction) => void act(data.candidate.id, action)} />
      {feedbackFor ? <CandidateFeedbackForm candidateId={feedbackFor} onDone={() => setFeedbackFor(null)} /> : null}
      <Card title="Evidence timeline">
        <p className="small muted">Each occurrence that contributed to this candidate, with the events that were captured. Privacy gaps are shown as grey bands.</p>
        {data.evidence.length === 0 ? <p className="muted">No evidence episodes are attached.</p> : null}
        {data.evidence.map(({ episode }) => (
          <div key={episode.id} className="row small" style={{ marginBottom: 6 }}>
            <Badge tone={episode.privacyStatus === "clean" ? "success" : "warning"}>{humanize(episode.privacyStatus)}</Badge>
            <span className="muted">Boundary: {episode.boundaryReasons.map(humanize).join(", ") || humanize(episode.boundary)}</span>
            {episode.triggerHypothesis ? <span className="muted">Trigger: {episode.triggerHypothesis}</span> : null}
          </div>
        ))}
        <Timeline groups={groups} label="Candidate evidence" />
      </Card>
    </div>
  );
}
