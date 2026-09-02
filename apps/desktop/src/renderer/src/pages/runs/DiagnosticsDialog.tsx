import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { ErrorState } from "../../components/States";
import { invoke } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

type Preview = Awaited<ReturnType<typeof invoke<"runs:previewDiagnostics">>>;

/** Previews sanitised diagnostics files before exporting them. */
export function DiagnosticsButton({ runId }: { runId: string }): JSX.Element {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async (): Promise<void> => {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      setPreview(await invoke("runs:previewDiagnostics", { runId }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await invoke("runs:exportDiagnostics", { runId });
      toast("success", `Exported ${result.fileCount} files (${formatBytes(result.byteLength)}) to ${result.path}`);
      await invoke("app:revealPath", { path: result.path });
      setOpen(false);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Button onClick={() => void load()} busy={busy}>
        Export sanitized diagnostics
      </Button>
      <Dialog
        open={open}
        title="Diagnostics preview"
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" busy={exporting} disabled={!preview} onClick={() => void doExport()}>
              Export these files
            </Button>
          </>
        }
      >
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {preview ? (
          <div className="stack">
            <p className="small muted">These files will be written to a zip on this Mac. Nothing is uploaded. Screenshots are never included.</p>
            <div className="callout callout-info">
              <strong>Redacted fields:</strong> {preview.redactedFields.length > 0 ? preview.redactedFields.join(", ") : "none"}
            </div>
            {preview.files.map((f) => (
              <div key={f.name}>
                <div className="row-between">
                  <strong className="mono">{f.name}</strong>
                  <span className="small muted">{formatBytes(f.byteLength)}</span>
                </div>
                <pre>{f.preview}</pre>
              </div>
            ))}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
