import type { JSX } from "react";

export function JsonView({ value, label }: { value: unknown; label?: string }): JSX.Element {
  return (
    <pre className="json-view" aria-label={label} tabIndex={0}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
