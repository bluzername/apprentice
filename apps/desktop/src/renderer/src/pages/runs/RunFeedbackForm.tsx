import { useState, type JSX } from "react";
import type { FailureCategory } from "@apprentice/schemas";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Checkbox, RadioGroup, Select, TextArea, TextInput } from "../../components/Field";
import { invoke } from "../../lib/api";
import { failureLabel } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

const FAILURES: ReadonlyArray<FailureCategory> = ["none", "model_unavailable", "invalid_action", "policy_blocked", "stale_screen", "target_ambiguous", "user_rejected", "user_interrupted", "timeout", "verification_failed", "helper_error", "sensitive_context", "max_steps", "unknown"];

interface RunFeedbackFormProps {
  runId: string;
  defaultFailure: FailureCategory;
  onDone: () => void;
}

export function RunFeedbackForm({ runId, defaultFailure, onDone }: RunFeedbackFormProps): JSX.Element {
  const { toast } = useStore();
  const [outcome, setOutcome] = useState<"yes" | "partly" | "no" | null>(null);
  const [corrections, setCorrections] = useState("0");
  const [saved, setSaved] = useState("0");
  const [trust, setTrust] = useState<number | null>(null);
  const [again, setAgain] = useState(false);
  const [failure, setFailure] = useState<FailureCategory>(defaultFailure);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const correctionsNum = Number(corrections);
  const savedNum = Number(saved);
  const valid = outcome !== null && trust !== null && Number.isInteger(correctionsNum) && correctionsNum >= 0 && correctionsNum <= 999 && savedNum >= 0 && savedNum <= 600;

  const submit = async (): Promise<void> => {
    if (!outcome || trust === null) return;
    setBusy(true);
    try {
      await invoke("feedback:submit", {
        contextType: "run",
        contextId: runId,
        answers: { kind: "run", outcomeAchieved: outcome, corrections: correctionsNum, estimatedTimeSavedMinutes: savedNum, trustRating: trust, wouldUseAgain: again, failureCategory: failure },
        ...(comment.trim() ? { comment: comment.trim() } : {})
      });
      toast("success", "Run feedback stored locally");
      onDone();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="How did this run go?">
      <div className="stack">
        <RadioGroup legend="Outcome achieved" value={outcome} onValueChange={setOutcome} inline options={[{ value: "yes", label: "Yes" }, { value: "partly", label: "Partly" }, { value: "no", label: "No" }]} />
        <div className="grid-2">
          <TextInput label="Corrections you made" type="number" min={0} max={999} value={corrections} onValueChange={setCorrections} />
          <TextInput label="Estimated time saved (minutes)" type="number" min={0} max={600} value={saved} onValueChange={setSaved} />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Trust (1 = none, 5 = full)</legend>
          <div className="rating" role="radiogroup" aria-label="Trust rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n}>
                <input type="radio" name="trust" value={n} checked={trust === n} onChange={() => setTrust(n)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Checkbox label="I would use this again" checked={again} onCheckedChange={setAgain} />
        <Select label="Failure category" value={failure} onValueChange={(v) => setFailure(v as FailureCategory)} options={FAILURES.map((f) => ({ value: f, label: failureLabel(f) }))} />
        <TextArea label="Comment (optional)" value={comment} onValueChange={setComment} maxLength={2000} hint="Free text. Included in remote upload only if you enabled it." />
        <div className="row">
          <Button variant="primary" busy={busy} disabled={!valid} onClick={() => void submit()}>
            Send structured feedback
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Skip
          </Button>
        </div>
      </div>
    </Card>
  );
}
