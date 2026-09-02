import { useCallback, type JSX } from "react";
import type { Run } from "@apprentice/schemas";
import { Badge } from "../components/Badge";
import { CardSkeleton } from "../components/Skeleton";
import { EmptyState, ErrorState } from "../components/States";
import { Table, type Column } from "../components/Table";
import { invoke } from "../lib/api";
import { failureLabel, formatDuration, formatRelative, humanize, runStatusLabel } from "../lib/format";
import { useIpcEvent, useLoader } from "../lib/hooks";
import { buildHash, navigate } from "../lib/router";
import { RunDetail } from "./runs/RunDetail";

export function RunsPage({ id }: { id?: string }): JSX.Element {
  if (id) return <RunDetail id={id} />;
  return <RunList />;
}

const COLUMNS: ReadonlyArray<Column<Run>> = [
  {
    key: "skill",
    header: "Skill",
    render: (r) => (
      <a href={buildHash("runs", r.id)}>
        <strong>{r.skillName}</strong>
      </a>
    )
  },
  { key: "status", header: "Status", render: (r) => <Badge tone={r.status === "completed" ? "success" : r.status === "failed" ? "danger" : r.status.startsWith("awaiting") ? "warning" : "neutral"}>{runStatusLabel(r.status)}</Badge> },
  { key: "mode", header: "Mode", render: (r) => humanize(r.mode) },
  { key: "progress", header: "Subtask", render: (r) => `${Math.min(r.currentSubtaskIndex + 1, r.subtaskCount)}/${r.subtaskCount}` },
  { key: "steps", header: "Steps", render: (r) => r.metrics.steps },
  { key: "duration", header: "Duration", render: (r) => formatDuration((r.endedAt ?? Date.now()) - r.startedAt) },
  { key: "failure", header: "Failure", render: (r) => (r.failureCategory === "none" ? "" : failureLabel(r.failureCategory)) },
  { key: "started", header: "Started", render: (r) => formatRelative(r.startedAt) }
];

function RunList(): JSX.Element {
  const loader = useCallback(() => invoke("runs:list", { limit: 50 }), []);
  const { data, error, loading, reload, setData } = useLoader(loader);
  useIpcEvent("event:run", ({ detail }) => {
    setData((current) => {
      if (!current) return current;
      const exists = current.some((r) => r.id === detail.run.id);
      return exists ? current.map((r) => (r.id === detail.run.id ? detail.run : r)) : [detail.run, ...current];
    });
  });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Runs</h2>
          <p>Every assisted run with its full trace. Press Escape on a running run to stop it immediately.</p>
        </div>
      </div>
      {error ? <ErrorState title="Could not load runs" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={2} /> : null}
      {!loading && !error && (data ?? []).length === 0 ? <EmptyState title="No runs yet" description="Open a skill and choose Run in guide mode, or use Try once on a candidate." /> : null}
      {(data ?? []).length > 0 ? <Table columns={COLUMNS} rows={data ?? []} rowKey={(r) => r.id} onRowClick={(r) => navigate("runs", r.id)} caption="Runs" /> : null}
    </div>
  );
}
