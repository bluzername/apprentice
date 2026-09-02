import { useState, type JSX } from "react";
import type { ModelStatus } from "@apprentice/schemas";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/Dialog";
import { Switch } from "../../components/Field";
import { ErrorState } from "../../components/States";
import { invoke } from "../../lib/api";
import { formatBytes, formatRelative, humanize } from "../../lib/format";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";
import { EndpointForm } from "../shared/EndpointForm";

type RuntimeAction = "installRuntime" | "installModel" | "start" | "stop" | "restart" | "cancelDownload";

const CONFIRMS: Record<RuntimeAction, { title: string; message: string; label: string }> = {
  installRuntime: { title: "Install the local runtime?", message: "Downloads the pinned llama.cpp server release and verifies its checksum. Nothing else changes.", label: "Install runtime" },
  installModel: { title: "Download the model?", message: "Downloads the pinned UI-Mate weights (several GB) and verifies their checksums. You can cancel at any time.", label: "Download model" },
  start: { title: "Start the local model server?", message: "Starts the llama.cpp process on 127.0.0.1. It uses several GB of unified memory while running.", label: "Start" },
  stop: { title: "Stop the local model server?", message: "Any run waiting on the model will fail with model_unavailable.", label: "Stop" },
  restart: { title: "Restart the local model server?", message: "Runs in progress will be interrupted.", label: "Restart" },
  cancelDownload: { title: "Cancel the download?", message: "Partial files are removed.", label: "Cancel download" }
};

export function ModelManager(): JSX.Element {
  const { state, dispatch, updateSettings, toast, reloadModel } = useStore();
  const model = state.model;
  const settings = state.settings;
  const [pending, setPending] = useState<RuntimeAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEndpoint, setShowEndpoint] = useState(false);

  const apply = async (fn: () => Promise<ModelStatus>, success: string): Promise<void> => {
    setBusy(true);
    try {
      dispatch({ type: "model", model: await fn() });
      toast("success", success);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const toggle = async (key: "onlyOnPower" | "onlyWhenIdle", value: boolean): Promise<void> => {
    if (!settings) return;
    try {
      await updateSettings({ model: { ...settings.model, [key]: value } });
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  if (!model && state.modelError) return <ErrorState title="Could not read the model status" message={state.modelError} onRetry={() => void reloadModel()} />;
  if (!model) return <p className="muted">Model status is not available.</p>;
  const rt = model.runtime;
  const download = rt.download;
  const progress = download?.active && download.totalBytes ? download.receivedBytes / download.totalBytes : null;
  const healthy = model.health?.ok ?? false;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <Badge tone={healthy ? "success" : model.paused ? "warning" : "danger"} dot>
            {healthy ? "Healthy" : model.paused ? "Stopped" : "Unavailable"}
          </Badge>
          <strong>{model.model ?? "No model"}</strong>
          <span className="muted small">{humanize(model.providerType)}, {humanize(model.location)}</span>
        </div>
        <Button variant="stop" busy={busy} onClick={() => void apply(() => invoke("model:stopAll"), "All local model work stopped")}>
          Stop all model work
        </Button>
      </div>
      {model.pauseReason ? <div className="callout callout-warning">{model.pauseReason}</div> : null}
      {model.health?.message && !healthy ? <div className="callout callout-danger">{model.health.message}</div> : null}
      <div className="model-grid">
        <div>
          <div className="stat-label">Memory recommendation</div>
          <div>{model.memoryRecommendation}</div>
        </div>
        <div>
          <div className="stat-label">Process</div>
          <div>{humanize(rt.processState)}{rt.port ? ` on port ${rt.port}` : ""}{rt.pid ? ` (pid ${rt.pid})` : ""}</div>
        </div>
        <div>
          <div className="stat-label">Inference queue</div>
          <div>{model.queue.pending} pending, {model.queue.active} active, peak {model.queue.peak}</div>
        </div>
        <div>
          <div className="stat-label">Last latency</div>
          <div>{model.lastLatencyMs !== undefined ? `${Math.round(model.lastLatencyMs)} ms` : "n/a"}{model.health ? ` (checked ${formatRelative(model.health.checkedAt)})` : ""}</div>
        </div>
        <div>
          <div className="stat-label">Screenshots used</div>
          <div>{model.screenshotsUsed}</div>
        </div>
        <div>
          <div className="stat-label">Runtime</div>
          <div>{rt.runtimeInstalled ? `Installed${rt.runtimeVersion ? ` (${rt.runtimeVersion})` : ""}` : "Not installed"}, model {rt.modelInstalled ? "installed" : "not installed"}</div>
        </div>
      </div>
      {rt.lastError ? <div className="callout callout-danger">Runtime error: {rt.lastError}</div> : null}
      {download?.active ? (
        <div className="stack-sm">
          <div className="row-between small">
            <span>Downloading {download.file ?? "model"}: {formatBytes(download.receivedBytes)}{download.totalBytes ? ` of ${formatBytes(download.totalBytes)}` : ""}</span>
            <Button size="sm" onClick={() => setPending("cancelDownload")}>Cancel</Button>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress !== null ? Math.round(progress * 100) : undefined} aria-label="Download progress">
            <span style={{ width: progress !== null ? `${Math.round(progress * 100)}%` : "30%" }} />
          </div>
        </div>
      ) : null}
      <div className="row">
        {!rt.runtimeInstalled ? <Button onClick={() => setPending("installRuntime")} disabled={busy}>Install runtime</Button> : null}
        {rt.runtimeInstalled && !rt.modelInstalled ? <Button onClick={() => setPending("installModel")} disabled={busy}>Download model</Button> : null}
        {rt.modelInstalled && rt.processState !== "running" ? <Button variant="primary" onClick={() => setPending("start")} disabled={busy}>Start</Button> : null}
        {rt.processState === "running" ? (
          <>
            <Button onClick={() => setPending("restart")} disabled={busy}>Restart</Button>
            <Button variant="danger" onClick={() => setPending("stop")} disabled={busy}>Stop</Button>
          </>
        ) : null}
        <Button variant="ghost" onClick={() => setShowEndpoint((s) => !s)} aria-expanded={showEndpoint}>
          {showEndpoint ? "Hide endpoint form" : "Use an external endpoint"}
        </Button>
        {model.providerType !== "mock" ? (
          <Button variant="ghost" disabled={busy} onClick={() => void apply(() => invoke("model:configure", { providerType: "mock" }), "Switched to demo mode (no model)")}>
            Switch to no model
          </Button>
        ) : null}
      </div>
      {showEndpoint ? (
        <div className="callout">
          <EndpointForm initial={settings?.model.endpoint ? { baseUrl: settings.model.endpoint.baseUrl, model: settings.model.endpoint.model } : undefined} onConfigured={() => { setShowEndpoint(false); void invoke("model:status").then((m) => dispatch({ type: "model", model: m })); toast("success", "Endpoint configured"); }} />
        </div>
      ) : null}
      <div className="stack-sm">
        <Switch label="Only process while connected to power" hint="Local analysis waits while on battery." checked={settings?.model.onlyOnPower ?? false} onCheckedChange={(v) => void toggle("onlyOnPower", v)} />
        <Switch label="Process when idle only" hint="Local analysis runs only when you have been idle for a while." checked={settings?.model.onlyWhenIdle ?? false} onCheckedChange={(v) => void toggle("onlyWhenIdle", v)} />
      </div>
      {pending ? (
        <ConfirmDialog
          open
          title={CONFIRMS[pending].title}
          message={CONFIRMS[pending].message}
          confirmLabel={CONFIRMS[pending].label}
          danger={pending === "stop" || pending === "cancelDownload"}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void apply(() => invoke("model:runtime", { action: pending, confirmed: true }), `${CONFIRMS[pending].label}: done`)}
        />
      ) : null}
    </div>
  );
}
