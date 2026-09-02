import { useCallback, useState, type JSX } from "react";
import type { PermissionsStatus } from "@apprentice/schemas";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { invoke } from "../../lib/api";
import { errorMessage, useInterval, useLoader } from "../../lib/hooks";
import { useStore } from "../../state/store";

type Kind = "accessibility" | "screenRecording";

const KINDS: ReadonlyArray<{ kind: Kind; label: string; why: string }> = [
  { kind: "screenRecording", label: "Screen Recording", why: "Needed to capture sparse screenshots of allowed apps and to read on-screen text locally. Without it there is no visual context and no verification of run steps." },
  { kind: "accessibility", label: "Accessibility", why: "Needed to know which app and window is frontmost, to read element roles and labels, and to perform approved clicks and key presses during a run." }
];

function tone(status: PermissionsStatus[Kind]): "success" | "danger" | "warning" | "neutral" {
  if (status === "granted") return "success";
  if (status === "denied") return "danger";
  if (status === "not_determined") return "warning";
  return "neutral";
}

export function StepPermissions(): JSX.Element {
  const { toast } = useStore();
  const loader = useCallback(() => invoke("permissions:status"), []);
  const { data, reload, error } = useLoader(loader);
  const [busy, setBusy] = useState<Kind | null>(null);
  useInterval(reload, 2000);

  const request = async (kind: Kind): Promise<void> => {
    setBusy(kind);
    try {
      await invoke("permissions:request", { kind });
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openSettings = async (kind: Kind): Promise<void> => {
    try {
      await invoke("permissions:openSettings", { kind });
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <div className="stack">
      <h2>Permissions</h2>
      <p>macOS asks for these separately. Status refreshes every two seconds, so you can grant them in System Settings and come back.</p>
      {error ? <div className="callout callout-danger">{error}</div> : null}
      {data && !data.helperAvailable ? <div className="callout callout-warning">The native helper is not available yet. Permissions can still be granted; capture starts once the helper is running.</div> : null}
      <div className="card">
        {KINDS.map(({ kind, label, why }) => {
          const status = data?.[kind] ?? "unknown";
          return (
            <div key={kind} className="perm-row">
              <div>
                <div className="row">
                  <strong>{label}</strong>
                  <Badge tone={tone(status)} dot>
                    {status === "granted" ? "Granted" : status === "denied" ? "Denied" : status === "not_determined" ? "Not asked yet" : "Unknown"}
                  </Badge>
                </div>
                <p className="small muted" style={{ marginTop: 4 }}>{why}</p>
              </div>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                {status !== "granted" ? (
                  <Button size="sm" variant="primary" busy={busy === kind} onClick={() => void request(kind)}>
                    Grant
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => void openSettings(kind)}>
                  Open System Settings
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
