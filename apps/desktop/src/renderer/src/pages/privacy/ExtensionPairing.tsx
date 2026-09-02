import { useState, type JSX } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { invoke } from "../../lib/api";
import { formatRelative, formatTime } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

export function ExtensionPairing(): JSX.Element {
  const { state, dispatch, toast } = useStore();
  const ext = state.extension;
  const [code, setCode] = useState<{ code: string; expiresAt: number; port: number } | null>(null);
  const [busy, setBusy] = useState(false);

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
            <Button variant="danger" size="sm" busy={busy} onClick={() => void unpair()}>
              Unpair
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {code ? (
            <div className="callout callout-info">
              <div className="pairing-code" aria-label={`Pairing code ${code.code.split("").join(" ")}`}>{code.code}</div>
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
