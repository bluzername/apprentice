import type { JSX } from "react";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@apprentice/schemas";
import { Card } from "../../components/Card";

export function StepIntro(): JSX.Element {
  return (
    <div className="stack">
      <h2>Local first</h2>
      <p>{PRODUCT_TAGLINE}</p>
      <div className="grid-2">
        <Card title="Stays on this Mac">
          <ul style={{ marginBottom: 0 }}>
            <li>Every event, screenshot and OCR result, encrypted at rest</li>
            <li>Episodes, candidates, skills and run traces</li>
            <li>Model inference, when you use a local model</li>
            <li>Your feedback answers and comments</li>
          </ul>
        </Card>
        <Card title="Can leave, only if you opt in">
          <ul style={{ marginBottom: 0 }}>
            <li>Structured feedback: multiple-choice answers, counts and hardware buckets</li>
            <li>You preview the exact payload before every upload</li>
            <li>Never screenshots, OCR, URLs, window titles or typed text</li>
          </ul>
        </Card>
      </div>
      <div className="callout">
        {PRODUCT_NAME} never records ordinary keystrokes, secure fields, clipboard contents or field values. It watches only the apps and domains you allow, and it never acts on its own: each action is shown to you and executed only after you approve it.
      </div>
    </div>
  );
}
