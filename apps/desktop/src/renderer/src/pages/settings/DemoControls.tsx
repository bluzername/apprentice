import { useCallback, useState, type JSX } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Select } from "../../components/Field";
import { invoke } from "../../lib/api";
import { errorMessage, useLoader } from "../../lib/hooks";
import { useStore } from "../../state/store";

export function DemoControls(): JSX.Element {
  const { state, updateSettings, toast, reloadSettings } = useStore();
  const loader = useCallback(() => invoke("demo:status"), []);
  const { data, reload, error } = useLoader(loader);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const demoMode = state.settings?.demoMode ?? false;

  const load = async (): Promise<void> => {
    setBusy(true);
    try {
      if (!demoMode) await updateSettings({ demoMode: true });
      const status = await invoke("demo:load", { days });
      toast("success", `Loaded ${status.daysSimulated} simulated days (${status.scenario.join(", ")})`);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    setBusy(true);
    try {
      await invoke("demo:reset");
      await reloadSettings();
      toast("success", "Demo data removed");
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <Badge tone={demoMode ? "warning" : "neutral"} dot>{demoMode ? "Demo mode on" : "Demo mode off"}</Badge>
        {data ? <span className="small muted">{data.loaded ? `${data.daysSimulated} days loaded: ${data.scenario.join(", ") || "no scenarios"}` : "No demo data loaded"}</span> : null}
        {error ? <span className="field-error">{error}</span> : null}
      </div>
      <p className="small muted">Demo mode uses synthetic episodes and rendered screenshots so you can try every journey without capturing anything real.</p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <Select label="Days to simulate" value={String(days)} onValueChange={(v) => setDays(Number(v))} options={[1, 3, 7, 14].map((n) => ({ value: String(n), label: `${n} days` }))} />
        <Button busy={busy} onClick={() => void load()}>
          Load demo data
        </Button>
        <Button variant="danger" disabled={busy || !data?.loaded} onClick={() => setConfirmReset(true)}>
          Reset demo data
        </Button>
      </div>
      <ConfirmDialog open={confirmReset} title="Reset demo data?" message="All synthetic episodes, candidates, skills and runs created by demo mode will be removed." confirmLabel="Reset" danger busy={busy} onConfirm={() => void reset()} onCancel={() => setConfirmReset(false)} />
    </div>
  );
}
