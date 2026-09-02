import { useCallback, useState, type JSX } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Table, type Column } from "../../components/Table";
import { ErrorState } from "../../components/States";
import { Skeleton } from "../../components/Skeleton";
import { invoke } from "../../lib/api";
import { formatDuration, formatTime, humanize } from "../../lib/format";
import { errorMessage, useLoader } from "../../lib/hooks";
import { useStore } from "../../state/store";
import type { Episode } from "@apprentice/schemas";

const COLUMNS: ReadonlyArray<Column<Episode>> = [
  { key: "time", header: "Time", render: (e) => `${formatTime(e.startTs)} to ${formatTime(e.endTs)}` },
  { key: "duration", header: "Active", render: (e) => formatDuration(e.activeDurationMs) },
  { key: "events", header: "Events", render: (e) => e.eventIds.length },
  { key: "apps", header: "Apps / domains", render: (e) => [...e.apps, ...e.domains].join(", ") },
  { key: "boundary", header: "Boundary", render: (e) => (
    <span className="row">
      <Badge tone={e.boundary === "explicit" ? "accent" : "neutral"}>{humanize(e.boundary)}</Badge>
      <span className="small muted">{e.boundaryReasons.map(humanize).join(", ")}</span>
    </span>
  ) },
  { key: "privacy", header: "Privacy", render: (e) => <Badge tone={e.privacyStatus === "clean" ? "success" : "warning"}>{humanize(e.privacyStatus)}</Badge> },
  { key: "analysis", header: "Analysis", render: (e) => humanize(e.analysisStatus) }
];

/** Debug drawer listing episode boundaries with reasons and a resegment action. */
export function EpisodeDrawer(): JSX.Element {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const loader = useCallback(() => (open ? invoke("episodes:list", { limit: 100 }) : Promise.resolve([] as Episode[])), [open]);
  const { data, error, loading, reload } = useLoader(loader);
  const [busy, setBusy] = useState(false);

  const resegment = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await invoke("episodes:resegment");
      toast("success", `Segmentation complete: ${result.episodes} episodes, ${result.candidates} candidates`);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="drawer" aria-label="Episode boundaries">
      <div className="row-between">
        <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="episode-drawer">
          {open ? "Hide" : "Show"} episode boundaries (debug)
        </Button>
        {open ? (
          <Button size="sm" busy={busy} onClick={() => void resegment()}>
            Re-run segmentation
          </Button>
        ) : null}
      </div>
      {open ? (
        <div id="episode-drawer" style={{ marginTop: 12 }}>
          {error ? <ErrorState message={error} onRetry={reload} /> : loading ? <Skeleton lines={4} /> : <Table columns={COLUMNS} rows={data ?? []} rowKey={(e) => e.id} caption="Episodes" emptyMessage="No episodes yet." />}
        </div>
      ) : null}
    </section>
  );
}
