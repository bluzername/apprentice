import { useEffect, useState, type JSX } from "react";
import type { Run, RunStep } from "@apprentice/schemas";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Checkbox, Select } from "../../components/Field";
import { ScreenshotThumb } from "../../components/ScreenshotThumb";
import { invoke } from "../../lib/api";
import { formatBytes, formatRelative, pluralize } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

interface ExportBundleDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Export bundle with an optional run and an explicit per-screenshot picker. Default: no screenshots. */
export function ExportBundleDialog({ open, onClose }: ExportBundleDialogProps): JSX.Element {
  const { toast } = useStore();
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [includeShots, setIncludeShots] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    invoke("runs:list", { limit: 50 })
      .then(setRuns)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [open]);

  useEffect(() => {
    setSteps([]);
    setPicked(new Set());
    if (!runId) return;
    invoke("runs:get", { id: runId })
      .then((detail) => setSteps(detail.steps))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [runId]);

  const shots = steps.filter((s) => s.screenshotRef).map((s) => ({ id: s.screenshotRef as string, label: `Step ${s.index + 1}: ${s.actionSummary || "screenshot"}` }));

  const doExport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke("feedback:export", { ...(runId ? { includeRunId: runId } : {}), screenshotIds: includeShots ? [...picked] : [] });
      toast("success", `Bundle written: ${result.fileCount} files, ${formatBytes(result.byteLength)}${result.includesScreenshots ? ", includes screenshots" : ", no screenshots"}`);
      await invoke("app:revealPath", { path: result.path });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Export feedback bundle"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void doExport()}>
            Export {includeShots && picked.size > 0 ? `with ${pluralize(picked.size, "screenshot")}` : "without screenshots"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">The bundle is a zip written to this Mac containing local feedback, product events and, optionally, one sanitised run trace. You choose whether to attach any screenshot, one by one, after viewing it.</p>
        {error ? (
          <div className="callout callout-danger" role="alert">
            {error}
          </div>
        ) : null}
        <Select label="Include a run trace (optional)" value={runId} onValueChange={setRunId} options={[{ value: "", label: "No run" }, ...runs.map((r) => ({ value: r.id, label: `${r.skillName} (${r.status}, ${formatRelative(r.startedAt)})` }))]} />
        {runId ? (
          <>
            <Checkbox label="Attach selected screenshots from this run" hint="Off by default. Screenshots may contain personal information; review each one before selecting." checked={includeShots} onCheckedChange={setIncludeShots} />
            {includeShots ? (
              shots.length === 0 ? (
                <p className="muted small">This run has no screenshots.</p>
              ) : (
                <div className="grid-3">
                  {shots.map((shot) => (
                    <div key={shot.id} className="stack-sm">
                      <ScreenshotThumb id={shot.id} width={1440} height={900} maxWidth={260} label={shot.label} />
                      <Checkbox
                        label={`Include ${shot.label}`}
                        checked={picked.has(shot.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(picked);
                          if (checked) next.add(shot.id);
                          else next.delete(shot.id);
                          setPicked(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
