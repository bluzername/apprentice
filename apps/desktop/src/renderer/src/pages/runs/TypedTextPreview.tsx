import type { JSX } from "react";
import { lineBreakHint, visualizeTypedText } from "../../lib/typed-text";

interface TypedTextPreviewProps {
  text: string;
  /** Unique per instance; several previews can appear in one trace. */
  id: string;
  small?: boolean;
}

/**
 * The exact text the helper will type, with every invisible character made
 * visible: line breaks (each presses Enter) and leading or trailing spaces.
 */
export function TypedTextPreview({ text, id, small = false }: TypedTextPreviewProps): JSX.Element {
  const labelId = `${id}-label`;
  const hint = lineBreakHint(text);
  return (
    <div className="field">
      <span className={`field-label${small ? " small" : ""}`} id={labelId}>
        Exact text that will be typed
      </span>
      <pre className={`typed-text${small ? " small" : ""}`} aria-labelledby={labelId}>
        {visualizeTypedText(text)}
      </pre>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
