import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Checkbox, RadioGroup, TextArea } from "../../components/Field";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

type Delegate = "yes" | "maybe" | "no";
type Boundary = "correct" | "started_too_early" | "started_too_late" | "ended_too_early" | "ended_too_late";
type Reason = "not_a_workflow" | "too_rare" | "too_simple" | "too_risky" | "wrong_steps" | "private" | "already_automated" | "prefer_manual" | "other";

const REASONS: ReadonlyArray<{ value: Reason; label: string }> = [
  { value: "not_a_workflow", label: "Not really a workflow" },
  { value: "too_rare", label: "Too rare" },
  { value: "too_simple", label: "Too simple to delegate" },
  { value: "too_risky", label: "Too risky" },
  { value: "wrong_steps", label: "Steps are wrong" },
  { value: "private", label: "Private" },
  { value: "already_automated", label: "Already automated" },
  { value: "prefer_manual", label: "I prefer doing it myself" },
  { value: "other", label: "Other" }
];

interface CandidateFeedbackFormProps {
  candidateId: string;
  onDone: () => void;
}

/** Structured feedback after a rejection action. Stored locally. */
export function CandidateFeedbackForm({ candidateId, onDone }: CandidateFeedbackFormProps): JSX.Element {
  const { toast } = useStore();
  const [relevant, setRelevant] = useState<"yes" | "no" | null>(null);
  const [delegate, setDelegate] = useState<Delegate | null>(null);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const complete = relevant !== null && delegate !== null && boundary !== null;

  const submit = async (): Promise<void> => {
    if (relevant === null || !delegate || !boundary) return;
    setBusy(true);
    try {
      await invoke("feedback:submit", {
        contextType: "candidate",
        contextId: candidateId,
        answers: { kind: "candidate", relevant: relevant === "yes", wouldDelegate: delegate, boundaryAccuracy: boundary, reasonCodes: reasons },
        ...(comment.trim() ? { comment: comment.trim() } : {})
      });
      toast("success", "Feedback stored locally");
      onDone();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Help improve candidate quality" className="callout-info">
      <p className="small muted">Four quick answers, stored on this Mac. They train nothing automatically; they help the alpha team tune the detector.</p>
      <div className="stack">
        <RadioGroup legend="Was this a real, relevant workflow?" value={relevant} onValueChange={setRelevant} inline options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
        <RadioGroup legend="Would you delegate it?" value={delegate} onValueChange={setDelegate} inline options={[{ value: "yes", label: "Yes" }, { value: "maybe", label: "Maybe" }, { value: "no", label: "No" }]} />
        <RadioGroup
          legend="Boundary accuracy"
          value={boundary}
          onValueChange={setBoundary}
          inline
          options={[
            { value: "correct", label: "Correct" },
            { value: "started_too_early", label: "Started too early" },
            { value: "started_too_late", label: "Started too late" },
            { value: "ended_too_early", label: "Ended too early" },
            { value: "ended_too_late", label: "Ended too late" }
          ]}
        />
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Reasons (optional)</legend>
          <div className="row">
            {REASONS.map((r) => (
              <Checkbox key={r.value} label={r.label} checked={reasons.includes(r.value)} onCheckedChange={(checked) => setReasons(checked ? [...reasons, r.value] : reasons.filter((x) => x !== r.value))} />
            ))}
          </div>
        </fieldset>
        <TextArea label="Comment (optional)" value={comment} onValueChange={setComment} maxLength={2000} hint="Free text. Included in remote upload only if you enabled it, so avoid personal details." />
        <div className="row">
          <Button variant="primary" busy={busy} disabled={!complete} onClick={() => void submit()}>
            Submit feedback
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Skip
          </Button>
        </div>
      </div>
    </Card>
  );
}
