import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { JsonView } from "../../components/JsonView";
import { invoke } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { ErrorState } from "../../components/States";

type Preview = Awaited<ReturnType<typeof invoke<"feedback:previewPayload">>>;

/** Button that opens a dialog showing exactly what a remote upload would send. */
export function PayloadPreviewButton({ label = "Preview outgoing payload" }: { label?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      setPreview(await invoke("feedback:previewPayload"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => void load()} busy={busy}>
        {label}
      </Button>
      <Dialog open={open} title="Outgoing feedback payload" onClose={() => setOpen(false)} wide footer={<Button onClick={() => setOpen(false)}>Close</Button>}>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {preview ? (
          <div className="stack">
            <p className="small muted">
              This is the exact JSON that would leave your Mac if you upload. {formatBytes(preview.byteLength)}. No screenshots, OCR, URLs, titles or free text are included.
            </p>
            {preview.removedFields.length > 0 ? (
              <div className="callout callout-info">
                <strong>Removed by sanitisation:</strong> {preview.removedFields.join(", ")}
              </div>
            ) : (
              <div className="callout">No fields needed removal.</div>
            )}
            <JsonView value={preview.payload} label="Outgoing payload JSON" />
          </div>
        ) : busy ? (
          <p>Building preview</p>
        ) : null}
      </Dialog>
    </>
  );
}
