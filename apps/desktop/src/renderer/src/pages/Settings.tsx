import { useState, type JSX } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/Dialog";
import { RadioGroup, Switch } from "../components/Field";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/hooks";
import { useStore } from "../state/store";
import { DemoControls } from "./settings/DemoControls";
import { ModelManager } from "./settings/ModelManager";
import { ShortcutField } from "./settings/ShortcutField";
import { AllowlistEditor } from "./shared/AllowlistEditor";

export function SettingsPage(): JSX.Element {
  const { state, updateSettings, toast } = useStore();
  const settings = state.settings;
  const [confirmSetup, setConfirmSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dataDir, setDataDir] = useState<string | null>(null);

  const save = async (patch: Parameters<typeof updateSettings>[0], success?: string): Promise<void> => {
    setBusy(true);
    try {
      await updateSettings(patch);
      if (success) toast("success", success);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runSetup = async (): Promise<void> => {
    await save({ onboardingCompleted: false, onboardingStep: 0 });
    setConfirmSetup(false);
    window.location.hash = "#/onboarding";
  };

  const loadDataDir = async (): Promise<void> => {
    try {
      setDataDir((await invoke("privacy:stats")).dataDirectory);
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  if (!settings) return <p className="muted">Loading settings</p>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Allowlist, shortcuts, model, appearance and experimental options.</p>
        </div>
      </div>
      <Card title="Allowed apps and domains" className="settings-section">
        <AllowlistEditor value={settings.allowlist} onChange={(allowlist) => void save({ allowlist })} />
      </Card>
      <Card title="Shortcuts" className="settings-section">
        <ShortcutField />
      </Card>
      <Card title="Model" className="settings-section">
        <ModelManager />
      </Card>
      <div className="grid-2">
        <Card title="Appearance" className="settings-section">
          <RadioGroup legend="Theme" value={settings.appearance} onValueChange={(appearance) => void save({ appearance })} inline options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Card>
        <Card title="Experimental" className="settings-section">
          <Switch label="Allow low-risk auto mode (experimental)" hint="Adds a low_risk_auto policy option to skills. Read-only and scroll actions can run without asking. Off by default; typing and sending always need approval." checked={settings.experimental.lowRiskAuto} onCheckedChange={(lowRiskAuto) => void save({ experimental: { lowRiskAuto } }, lowRiskAuto ? "Experimental low-risk auto enabled" : "Experimental low-risk auto disabled")} disabled={busy} />
        </Card>
      </div>
      <Card title="Demo mode" className="settings-section">
        <DemoControls />
      </Card>
      <Card title="Setup and about" className="settings-section">
        <div className="stack">
          <dl className="kv">
            <dt>Version</dt>
            <dd>{state.version ? `${state.version.productName} ${state.version.version}${state.version.helperVersion ? `, helper ${state.version.helperVersion}` : ""}` : "unknown"}</dd>
            <dt>Installation id</dt>
            <dd className="mono small">{settings.installationId}</dd>
            <dt>Data folder</dt>
            <dd>
              {dataDir ? <code className="small">{dataDir}</code> : <Button size="sm" variant="ghost" onClick={() => void loadDataDir()}>Show path</Button>}{" "}
              <Button size="sm" onClick={() => void invoke("app:openDataFolder").catch((err: unknown) => toast("error", errorMessage(err)))}>
                Open in Finder
              </Button>
            </dd>
          </dl>
          <div>
            <Button onClick={() => setConfirmSetup(true)}>Run setup again</Button>
          </div>
        </div>
      </Card>
      <ConfirmDialog open={confirmSetup} title="Run setup again?" message="You will go through the onboarding steps again. Your data, allowlist and skills are kept; you can change them during setup." confirmLabel="Start setup" busy={busy} onConfirm={() => void runSetup()} onCancel={() => setConfirmSetup(false)} />
    </div>
  );
}
