import type { JSX } from "react";
import type { VariableSlot } from "@apprentice/schemas";
import { Button } from "../../components/Button";
import { Checkbox, Select, TextInput } from "../../components/Field";

const KINDS: ReadonlyArray<VariableSlot["kind"]> = ["text", "identifier", "date", "amount", "person", "file", "url_path", "unknown"];

interface VariableEditorProps {
  variables: ReadonlyArray<VariableSlot>;
  onChange: (next: VariableSlot[]) => void;
}

export function VariableEditor({ variables, onChange }: VariableEditorProps): JSX.Element {
  const update = (index: number, patch: Partial<VariableSlot>): void => onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  return (
    <div className="stack">
      <div className="row-between">
        <span className="field-label">Variables ({variables.length})</span>
        <Button size="sm" onClick={() => onChange([...variables, { name: `variable_${variables.length + 1}`, kind: "text", examples: [], required: true }])} disabled={variables.length >= 20}>
          Add variable
        </Button>
      </div>
      {variables.length === 0 ? <span className="field-hint">Variables are the parts that change each time, such as a client name or a date.</span> : null}
      {variables.map((v, i) => (
        <div key={i} className="subtask-card">
          <div className="grid-3">
            <TextInput label="Name" value={v.name} onValueChange={(name) => update(i, { name })} maxLength={64} error={/^[A-Za-z0-9_]+$/.test(v.name) ? null : "Letters, digits and underscore only"} />
            <Select label="Kind" value={v.kind} onValueChange={(kind) => update(i, { kind: kind as VariableSlot["kind"] })} options={KINDS.map((k) => ({ value: k, label: k }))} />
            <TextInput label="Description" value={v.description ?? ""} onValueChange={(d) => update(i, { description: d || undefined })} maxLength={256} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Checkbox label="Required" checked={v.required} onCheckedChange={(required) => update(i, { required })} />
            <span className="small muted">Examples: {v.examples.length > 0 ? v.examples.join(", ") : "none"}</span>
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => onChange(variables.filter((_, j) => j !== i))} aria-label={`Remove variable ${v.name}`}>
              Remove
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
