import { useCallback, type JSX } from "react";
import { Badge, RiskBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CardSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/States";
import { invoke } from "../lib/api";
import { formatHours, formatMinutes, formatRelative, menuBarStatusLabel, pluralize, runStatusLabel } from "../lib/format";
import { useIpcEvent, useLoader } from "../lib/hooks";
import { buildHash, navigate } from "../lib/router";
import { useStore } from "../state/store";
import { PulsePrompt } from "./overview/PulsePrompt";

export function OverviewPage(): JSX.Element {
  const { state, toast } = useStore();
  const loader = useCallback(() => invoke("app:overview"), []);
  const { data, error, loading, reload } = useLoader(loader);
  useIpcEvent("event:candidate", () => reload());
  useIpcEvent("event:run", () => reload());
  useIpcEvent("event:learning", () => reload());

  const requestPermission = async (kind: "accessibility" | "screenRecording"): Promise<void> => {
    try {
      await invoke("permissions:request", { kind });
      reload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    }
  };

  if (error) return <ErrorState title="Could not load the overview" message={error} onRetry={reload} />;
  if (loading || !data) return <CardSkeleton count={4} />;

  const model = data.modelStatus;
  const modelHealthy = model.health?.ok ?? false;
  const permissionIssues: Array<{ kind: "accessibility" | "screenRecording"; label: string }> = [];
  if (data.permissions.accessibility !== "granted") permissionIssues.push({ kind: "accessibility", label: "Accessibility" });
  if (data.permissions.screenRecording !== "granted") permissionIssues.push({ kind: "screenRecording", label: "Screen Recording" });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Overview</h2>
          <p>What Apprentice has observed and learned on this Mac. {data.demoMode ? "Demo mode is on: this is synthetic data." : ""}</p>
        </div>
        <Button variant="primary" onClick={() => navigate("teach")}>
          Learn what I just did
        </Button>
      </div>

      {permissionIssues.length > 0 && !data.demoMode ? (
        <div className="callout callout-warning" role="alert">
          <div className="row-between">
            <span>
              <strong>Missing permissions:</strong> {permissionIssues.map((p) => p.label).join(", ")}. Observation is limited until they are granted.
            </span>
            <span className="row">
              {permissionIssues.map((p) => (
                <Button key={p.kind} size="sm" onClick={() => void requestPermission(p.kind)}>
                  Fix {p.label}
                </Button>
              ))}
            </span>
          </div>
        </div>
      ) : null}

      {data.pendingPulseDay ? <PulsePrompt day={data.pendingPulseDay} onDone={reload} /> : null}

      <div className="grid-4">
        <Card className="overview-card">
          <div className="stat-label">Learning status</div>
          <div className="stat" style={{ fontSize: "var(--text-xl)" }}>{menuBarStatusLabel(data.menuBarStatus)}</div>
          <div className="small muted">
            {state.settings ? `${pluralize(state.settings.allowlist.apps.length, "app")}, ${pluralize(state.settings.allowlist.domains.length, "domain")} allowed` : ""}
          </div>
        </Card>
        <Card className="overview-card">
          <div className="stat-label">Model</div>
          <div className="stat" style={{ fontSize: "var(--text-xl)" }}>{model.model ?? model.providerType}</div>
          <div className="row small">
            <Badge tone={modelHealthy ? "success" : "danger"} dot>
              {modelHealthy ? "Healthy" : model.paused ? "Stopped" : "Unavailable"}
            </Badge>
            <span className="muted">{model.providerType}, queue {model.queue.pending}</span>
          </div>
        </Card>
        <Card className="overview-card">
          <div className="stat-label">Hours observed</div>
          <div className="stat">{formatHours(data.hoursObserved)}</div>
          <div className="small muted">in allowed apps only</div>
        </Card>
        <Card className="overview-card">
          <div className="stat-label">Repeated routines</div>
          <div className="stat">{formatMinutes(data.estimatedWeeklyMinutes)}</div>
          <div className="small muted">estimated per week across {pluralize(data.candidateCount, "candidate")}</div>
        </Card>
      </div>

      <div className="grid-3">
        <Card title="Candidates" actions={<a href={buildHash("candidates")}>Open</a>}>
          <div className="stat">{data.candidateCount}</div>
          <div className="small muted">workflows observed at least twice</div>
        </Card>
        <Card title="Saved skills" actions={<a href={buildHash("skills")}>Open</a>}>
          <div className="stat">{data.skillCount}</div>
          <div className="small muted">inspectable and versioned</div>
        </Card>
        <Card title="Connections">
          <div className="stack-sm small">
            <div className="row-between">
              <span>Native helper</span>
              <Badge tone={data.helperConnected ? "success" : "warning"} dot>
                {data.helperConnected ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <div className="row-between">
              <span>Browser extension</span>
              <Badge tone={data.extensionPaired ? "success" : "neutral"} dot>
                {data.extensionPaired ? "Paired" : "Not paired"}
              </Badge>
            </div>
            {!data.extensionPaired ? <a href={buildHash("privacy")}>Pair the extension</a> : null}
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Most recent candidate">
          {data.recentCandidate ? (
            <div className="stack-sm">
              <strong>{data.recentCandidate.refinedTitle ?? data.recentCandidate.deterministicTitle}</strong>
              <div className="row small">
                <span>Observed {data.recentCandidate.repeatCount} times</span>
                <RiskBadge risk={data.recentCandidate.riskClass} />
              </div>
              <p className="small muted">{data.recentCandidate.confidenceExplanation}</p>
              <a href={buildHash("candidates", data.recentCandidate.id)}>Review evidence</a>
            </div>
          ) : (
            <p className="muted">No candidates yet. Candidates appear after a similar sequence is observed at least twice.</p>
          )}
        </Card>
        <Card title="Most recent run">
          {data.recentRun ? (
            <div className="stack-sm">
              <strong>{data.recentRun.skillName}</strong>
              <div className="row small">
                <Badge tone={data.recentRun.status === "completed" ? "success" : data.recentRun.status === "failed" ? "danger" : "info"}>{runStatusLabel(data.recentRun.status)}</Badge>
                <span className="muted">started {formatRelative(data.recentRun.startedAt)}</span>
              </div>
              <a href={buildHash("runs", data.recentRun.id)}>Open run</a>
            </div>
          ) : (
            <p className="muted">No runs yet. Save a skill and run it in guide mode to see a step-by-step trace here.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
