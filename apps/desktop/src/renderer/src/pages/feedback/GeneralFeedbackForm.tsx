import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { RadioGroup, TextArea } from "../../components/Field";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

export function GeneralFeedbackForm({ onSubmitted }: { onSubmitted: () => void }): JSX.Element {
  const { toast } = useStore();
  const [sentiment, setSentiment] = useState<"positive" | "neutral" | "negative" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!sentiment) return;
    setBusy(true);
    try {
      await invoke("feedback:submit", { contextType: "general", contextId: `general-${Date.now()}`, answers: { kind: "general", sentiment }, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      toast("success", "Feedback stored locally");
      setSentiment(null);
      setComment("");
      onSubmitted();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <RadioGroup legend="Overall, how is it going?" value={sentiment} onValueChange={setSentiment} inline options={[{ value: "positive", label: "Good" }, { value: "neutral", label: "Mixed" }, { value: "negative", label: "Not good" }]} />
      <TextArea label="Comment (optional)" value={comment} onValueChange={setComment} maxLength={2000} hint="Free text stays local unless remote upload is on. Avoid names, emails and account details." />
      <div>
        <Button type="submit" variant="primary" busy={busy} disabled={!sentiment}>
          Submit
        </Button>
      </div>
    </form>
  );
}
