import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { RadioGroup, Checkbox, TextArea } from "../../components/Field";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

type PulseDay = 1 | 3 | 7;
type MostUseful = "candidates" | "teaching" | "guided_runs" | "privacy_controls" | "nothing_yet";
type Concern = "privacy" | "accuracy" | "speed" | "usefulness" | "setup" | "none";

interface PulsePromptProps {
  day: PulseDay;
  onDone: () => void;
}

const USEFUL: ReadonlyArray<{ value: MostUseful; label: string }> = [
  { value: "candidates", label: "Workflow candidates" },
  { value: "teaching", label: "Teaching a routine" },
  { value: "guided_runs", label: "Guided runs" },
  { value: "privacy_controls", label: "Privacy controls" },
  { value: "nothing_yet", label: "Nothing yet" }
];
const CONCERNS: ReadonlyArray<{ value: Concern; label: string }> = [
  { value: "privacy", label: "Privacy" },
  { value: "accuracy", label: "Accuracy" },
  { value: "speed", label: "Speed" },
  { value: "usefulness", label: "Usefulness" },
  { value: "setup", label: "Setup" },
  { value: "none", label: "No concern" }
];

/** Day 1/3/7 pulse. Submits structured answers only; comment is optional and warned. */
export function PulsePrompt({ day, onDone }: PulsePromptProps): JSX.Element {
  const { toast } = useStore();
  const [stillUsing, setStillUsing] = useState(true);
  const [mostUseful, setMostUseful] = useState<MostUseful | null>(null);
  const [concern, setConcern] = useState<Concern | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const complete = mostUseful !== null && concern !== null && score !== null;

  const submit = async (): Promise<void> => {
    if (!mostUseful || !concern || score === null) return;
    setBusy(true);
    try {
      await invoke("feedback:submit", {
        contextType: "pulse",
        contextId: `pulse-day-${day}`,
        answers: { kind: "pulse", day, stillUsing, mostUseful, biggestConcern: concern, recommendScore: score },
        ...(comment.trim() ? { comment: comment.trim() } : {})
      });
      toast("success", "Thanks, your answers are stored locally");
      onDone();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (): Promise<void> => {
    setBusy(true);
    try {
      await invoke("feedback:dismissPulse", { day });
      onDone();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Day ${day} check-in`} aria-live="polite">
      <p className="muted small">One minute, stored locally. You will not be asked again today.</p>
      <div className="stack">
        <Checkbox label="I am still using Apprentice" checked={stillUsing} onCheckedChange={setStillUsing} />
        <RadioGroup legend="Most useful so far" value={mostUseful} onValueChange={setMostUseful} options={USEFUL} inline />
        <RadioGroup legend="Biggest concern" value={concern} onValueChange={setConcern} options={CONCERNS} inline />
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">How likely are you to recommend it? (0 to 10)</legend>
          <div className="rating" role="radiogroup" aria-label="Recommend score">
            {Array.from({ length: 11 }, (_, i) => (
              <label key={i}>
                <input type="radio" name="pulse-score" value={i} checked={score === i} onChange={() => setScore(i)} />
                <span>{i}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextArea label="Comment (optional)" value={comment} onValueChange={setComment} maxLength={2000} hint="Comments are free text. If you later enable remote upload they are included as written, so avoid personal details." />
        <div className="row">
          <Button variant="primary" busy={busy} disabled={!complete} onClick={() => void submit()}>
            Submit
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void dismiss()}>
            Not now
          </Button>
        </div>
      </div>
    </Card>
  );
}
