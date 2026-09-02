import type { JSX } from "react";

/** Focusable, scrollable JSON block exposed as a named region. */
export function JsonView({ value, label }: { value: unknown; label?: string }): JSX.Element {
  return (
    <pre className="json-view" role="region" aria-label={label} tabIndex={0}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
