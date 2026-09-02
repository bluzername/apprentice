import type { JSX } from "react";
import { Button } from "../../components/Button";
import { TextArea, TextInput } from "../../components/Field";
import { ListEditor } from "../../components/ListEditor";

export interface SubtaskValue {
  title: string;
  goal: string;
  completionCriteria: string;
  keySteps: string[];
  appOrDomain?: string;
}

interface SubtaskEditorProps {
  subtasks: ReadonlyArray<SubtaskValue>;
  onChange: (next: SubtaskValue[]) => void;
}

const EMPTY: SubtaskValue = { title: "", goal: "", completionCriteria: "", keySteps: [] };

export function SubtaskEditor({ subtasks, onChange }: SubtaskEditorProps): JSX.Element {
  const update = (index: number, patch: Partial<SubtaskValue>): void => onChange(subtasks.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= subtasks.length) return;
    const next = [...subtasks];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };
  return (
    <div className="stack">
      <div className="row-between">
        <span className="field-label">Subtasks ({subtasks.length})</span>
        <Button size="sm" onClick={() => onChange([...subtasks, EMPTY])} disabled={subtasks.length >= 30}>
          Add subtask
        </Button>
      </div>
      {subtasks.length === 0 ? <span className="field-hint">At least one subtask is required.</span> : null}
      {subtasks.map((s, i) => (
        <fieldset key={i} className="subtask-card" style={{ border: "1px solid var(--border)", margin: 0 }}>
          <legend className="row" style={{ padding: "0 6px" }}>
            <strong>Subtask {i + 1}</strong>
            <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move subtask ${i + 1} up`}>
              Up
            </Button>
            <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === subtasks.length - 1} aria-label={`Move subtask ${i + 1} down`}>
              Down
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(subtasks.filter((_, j) => j !== i))} disabled={subtasks.length <= 1} aria-label={`Remove subtask ${i + 1}`}>
              Remove
            </Button>
          </legend>
          <div className="stack">
            <div className="grid-2">
              <TextInput label="Title" value={s.title} onValueChange={(title) => update(i, { title })} maxLength={120} error={s.title.trim() ? null : "Required"} />
              <TextInput label="App or domain" value={s.appOrDomain ?? ""} onValueChange={(v) => update(i, { appOrDomain: v || undefined })} maxLength={256} placeholder="notion.so" />
            </div>
            <TextInput label="Goal" value={s.goal} onValueChange={(goal) => update(i, { goal })} maxLength={500} error={s.goal.trim() ? null : "Required"} />
            <TextArea label="Completion criteria" value={s.completionCriteria} onValueChange={(completionCriteria) => update(i, { completionCriteria })} maxLength={500} rows={2} error={s.completionCriteria.trim() ? null : "Required"} hint="How the run knows this subtask is done, verified independently of the model." />
            <ListEditor label="Key steps" items={s.keySteps} onChange={(keySteps) => update(i, { keySteps })} placeholder="Open the note" max={20} addLabel="Add step" />
          </div>
        </fieldset>
      ))}
    </div>
  );
}
