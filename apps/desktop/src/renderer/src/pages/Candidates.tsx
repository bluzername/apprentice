import { useCallback, useState, type JSX } from "react";
import type { CandidateUserAction } from "@apprentice/schemas";
import { Switch } from "../components/Field";
import { CardSkeleton } from "../components/Skeleton";
import { EmptyState, ErrorState } from "../components/States";
import { Button } from "../components/Button";
import { invoke } from "../lib/api";
import { useIpcEvent, useLoader } from "../lib/hooks";
import { navigate } from "../lib/router";
import { CandidateCard } from "./candidates/CandidateCard";
import { CandidateDetail } from "./candidates/CandidateDetail";
import { CandidateFeedbackForm } from "./candidates/CandidateFeedbackForm";
import { useCandidateActions } from "./candidates/useCandidateActions";

export function CandidatesPage({ id }: { id?: string }): JSX.Element {
  if (id) return <CandidateDetail id={id} />;
  return <CandidateList />;
}

function CandidateList(): JSX.Element {
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const loader = useCallback(() => invoke("candidates:list", { includeSuppressed }), [includeSuppressed]);
  const { data, error, loading, reload, setData } = useLoader(loader);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const { act, busyAction } = useCandidateActions({
    onUpdated: (candidate) => setData((current) => (current ? current.map((c) => (c.id === candidate.id ? candidate : c)) : current)),
    onRejected: (candidateId) => setFeedbackFor(candidateId)
  });
  useIpcEvent("event:candidate", ({ candidate }) => {
    setData((current) => {
      if (!current) return current;
      const exists = current.some((c) => c.id === candidate.id);
      return exists ? current.map((c) => (c.id === candidate.id ? candidate : c)) : [candidate, ...current];
    });
  });

  const visible = (data ?? []).filter((c) => includeSuppressed || c.suppression.state === "active");

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Candidates</h2>
          <p>Routines observed at least twice. Every claim links to the evidence it came from.</p>
        </div>
        <Switch label="Show hidden candidates" checked={includeSuppressed} onCheckedChange={setIncludeSuppressed} />
      </div>
      {error ? <ErrorState title="Could not load candidates" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={2} /> : null}
      {feedbackFor && !visible.some((c) => c.id === feedbackFor) ? <CandidateFeedbackForm candidateId={feedbackFor} onDone={() => setFeedbackFor(null)} /> : null}
      {!loading && !error && visible.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          description="Candidates appear once a similar sequence of actions has been observed at least twice in allowed apps. You can also teach a routine directly."
          action={<Button onClick={() => navigate("teach")}>Learn what I just did</Button>}
        />
      ) : null}
      {visible.map((c) => (
        <div key={c.id} className="stack">
          <CandidateCard candidate={c} busyAction={busyAction} onAction={(action: CandidateUserAction) => void act(c.id, action)} />
          {feedbackFor === c.id ? <CandidateFeedbackForm candidateId={c.id} onDone={() => setFeedbackFor(null)} /> : null}
        </div>
      ))}
    </div>
  );
}
