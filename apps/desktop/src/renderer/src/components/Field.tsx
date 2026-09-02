import { useId, type InputHTMLAttributes, type JSX, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Wraps a control with a label, hint and error, wiring aria attributes. */
export function Field({ label, hint, error, children, className = "" }: FieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <div id={hintId} className="field-hint">
          {hint}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  onValueChange: (value: string) => void;
  small?: boolean;
}

export function TextInput({ label, hint, error, onValueChange, small = false, className = "", ...rest }: TextInputProps): JSX.Element {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={`input ${small ? "input-sm" : ""} ${className}`.trim()}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onValueChange(e.target.value)}
          {...rest}
        />
      )}
    </Field>
  );
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  onValueChange: (value: string) => void;
}

export function TextArea({ label, hint, error, onValueChange, className = "", ...rest }: TextAreaProps): JSX.Element {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} className={`textarea ${className}`.trim()} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => onValueChange(e.target.value)} {...rest} />
      )}
    </Field>
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
}

export function Select({ label, hint, error, onValueChange, options, className = "", ...rest }: SelectProps): JSX.Element {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className={`select ${className}`.trim()} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => onValueChange(e.target.value)} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface CheckboxProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}

export function Checkbox({ label, hint, checked, onCheckedChange, disabled, name }: CheckboxProps): JSX.Element {
  return (
    <label className="check">
      <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} />
      <span>
        <span>{label}</span>
        {hint ? <span className="field-hint" style={{ display: "block" }}>{hint}</span> : null}
      </span>
    </label>
  );
}

interface SwitchProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, hint, checked, onCheckedChange, disabled }: SwitchProps): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span>
        <span>{label}</span>
        {hint ? <span className="field-hint" style={{ display: "block" }}>{hint}</span> : null}
      </span>
    </label>
  );
}

interface RadioGroupProps<T extends string> {
  legend: ReactNode;
  value: T | null;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; hint?: ReactNode }>;
  inline?: boolean;
}

export function RadioGroup<T extends string>({ legend, value, onValueChange, options, inline = false }: RadioGroupProps<T>): JSX.Element {
  const name = useId();
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">{legend}</legend>
      <div className={inline ? "row" : "radio-group"}>
        {options.map((o) => (
          <label key={o.value} className="check">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onValueChange(o.value)} />
            <span>
              {o.label}
              {o.hint ? <span className="field-hint" style={{ display: "block" }}>{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
