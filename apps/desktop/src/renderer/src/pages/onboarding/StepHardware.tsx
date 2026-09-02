import { useCallback, type JSX } from "react";
import { Badge } from "../../components/Badge";
import { Card } from "../../components/Card";
import { Skeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/States";
import { invoke } from "../../lib/api";
import { useLoader } from "../../lib/hooks";

const EXPERIENCE: Record<string, { label: string; tone: "success" | "warning" | "neutral"; text: string }> = {
  full_local_model: { label: "Full local model", tone: "success", text: "This Mac can run the recommended local UI-Mate model with room to spare." },
  light_local_model: { label: "Light local model", tone: "warning", text: "A smaller quantised model is recommended. Expect slower steps and keep other heavy apps closed." },
  demo_or_external: { label: "Demo or external endpoint", tone: "neutral", text: "Running a local vision model is not recommended here. Use demo mode or connect an external endpoint." }
};

export function StepHardware(): JSX.Element {
  const loader = useCallback(() => invoke("app:hardware"), []);
  const { data, error, loading, reload } = useLoader(loader);
  if (error) return <ErrorState title="Could not read hardware information" message={error} onRetry={reload} />;
  if (loading || !data) return <Skeleton lines={5} />;
  const experience = EXPERIENCE[data.recommendedExperience] ?? EXPERIENCE.demo_or_external;
  return (
    <div className="stack">
      <h2>Hardware check</h2>
      <div className="grid-2">
        <Card>
          <dl className="kv">
            <dt>Chip</dt>
            <dd>{data.chip} ({data.arch})</dd>
            <dt>Unified memory</dt>
            <dd>{data.memoryGb} GB</dd>
            <dt>Free disk</dt>
            <dd>{Math.round(data.freeDiskGb)} GB</dd>
            <dt>macOS</dt>
            <dd>{data.macosVersion}</dd>
          </dl>
        </Card>
        <Card title="Recommended experience">
          {experience ? (
            <>
              <Badge tone={experience.tone}>{experience.label}</Badge>
              <p style={{ marginTop: 8 }}>{experience.text}</p>
            </>
          ) : null}
          {!data.isAppleSilicon ? <div className="callout callout-warning">Apple Silicon is required for local models. Demo mode still works.</div> : null}
          {data.macosMajor < 14 ? <div className="callout callout-warning">macOS 14 or newer is required for screen capture via ScreenCaptureKit.</div> : null}
        </Card>
      </div>
    </div>
  );
}
