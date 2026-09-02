import { useState, type JSX } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog } from "../../components/Dialog";
import { invoke } from "../../lib/api";
import { formatRelative, formatTime } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

export function ExtensionPairing(): JSX.Element {
  const { state, dispatch, toast } = useStore();
  const ext = state.extension;
  const [code, setCode] = useState<{ code: string; expiresAt: number; port: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  const requestCode = async (): Promise<void> => {
    setBusy(true);
    try {
      setCode(await invoke("extension:pairingCode"));
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const unpair = async (): Promise<void> => {
    setBusy(true);
    try {
      dispatch({ type: "extension", extension: await invoke("extension:unpair") });
      setCode(null);
      toast("success", "Extension unpaired");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmUnpair(false);
    }
  };

  return (
    <Card title="Browser extension" actions={<Badge tone={ext?.paired ? "success" : "neutral"} dot>{ext?.paired ? "Paired" : "Not paired"}</Badge>}>
      <p className="small muted">The extension reports navigation and clicks for allowed domains only, over a loopback connection to 127.0.0.1 with a pairing token. Page contents are never sent.</p>
      {ext?.paired ? (
        <div className="stack-sm">
          <dl className="kv">
            <dt>Browser</dt>
            <dd>{ext.browser ?? "unknown"}</dd>
            <dt>Last seen</dt>
            <dd>{ext.lastSeenTs ? formatRelative(ext.lastSeenTs) : "never"}</dd>
            <dt>Events received</dt>
            <dd>{ext.eventsReceived}</dd>
          </dl>
          <div>
            <Button variant="danger" size="sm" busy={busy} onClick={() => setConfirmUnpair(true)}>
              Unpair
            </Button>
          </div>
          <ConfirmDialog
            open={confirmUnpair}
            title="Unpair the browser extension?"
            message="The pairing token is revoked and browser events stop arriving. To reconnect you will need to generate a new pairing code and enter it in the extension."
            confirmLabel="Unpair"
            danger
            busy={busy}
            onConfirm={() => void unpair()}
            onCancel={() => setConfirmUnpair(false)}
          />
        </div>
      ) : (
        <div className="stack-sm">
          {code ? (
            <div className="callout callout-info">
              <output className="pairing-code">
                <span aria-hidden="true">{code.code}</span>
                <span className="visually-hidden">Pairing code {code.code.split("").join(" ")}</span>
              </output>
              <div className="small">Enter this code in the extension popup before {formatTime(code.expiresAt)}. Port {code.port}.</div>
            </div>
          ) : null}
          <div>
            <Button busy={busy} onClick={() => void requestCode()}>
              {code ? "New pairing code" : "Generate pairing code"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
