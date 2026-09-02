import { useState, type JSX } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";

interface ListEditorProps {
  label: string;
  items: ReadonlyArray<string>;
  onChange: (items: string[]) => void;
  placeholder?: string;
  validate?: (value: string) => { ok: boolean; value?: string; message?: string };
  max?: number;
  addLabel?: string;
}

/** Add/remove list of short strings with validation and keyboard support. */
export function ListEditor({ label, items, onChange, placeholder, validate, max, addLabel = "Add" }: ListEditorProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const atMax = max !== undefined && items.length >= max;

  const add = (): void => {
    const result = validate ? validate(draft) : { ok: draft.trim().length > 0, value: draft.trim(), message: "Enter a value." };
    if (!result.ok || !result.value) {
      setError(result.message ?? "Invalid value.");
      return;
    }
    if (items.includes(result.value)) {
      setError("Already in the list.");
      return;
    }
    onChange([...items, result.value]);
    setDraft("");
    setError(null);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {items.length > 0 ? (
        <ul className="chips" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((item) => (
            <li key={item} className="chip">
              <span>{item}</span>
              <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="field-hint">Nothing added yet.</span>
      )}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          className="input input-sm"
          aria-label={`New ${label}`}
          placeholder={placeholder}
          value={draft}
          disabled={atMax}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" onClick={add} disabled={atMax}>
          <Icon name="plus" size={14} />
          {addLabel}
        </Button>
      </div>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
