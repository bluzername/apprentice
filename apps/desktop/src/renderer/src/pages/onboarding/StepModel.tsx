import { useCallback, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Field";
import { Skeleton } from "../../components/Skeleton";
import { invoke } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { errorMessage, useLoader } from "../../lib/hooks";
import { useStore } from "../../state/store";
import { EndpointForm } from "../shared/EndpointForm";

type Choice = "demo" | "endpoint" | "uimate" | "mlx";

const CHOICES: ReadonlyArray<{ id: Choice; title: string; text: string }> = [
  { id: "demo", title: "Demo mode, no model", text: "Synthetic data and deterministic drafts. Try every journey without downloading anything." },
  { id: "endpoint", title: "Connect an existing OpenAI-compatible endpoint", text: "llama.cpp, LM Studio, vLLM, Ollama or any server on your network." },
  { id: "uimate", title: "Install the recommended local UI-Mate route", text: "Downloads a pinned llama.cpp release and the UI-Mate-9B weights with checksum verification. Runs on 127.0.0.1." },
  { id: "mlx", title: "Advanced: MLX", text: "Serve the model with MLX yourself, then connect it as an endpoint." }
];

interface StepModelProps {
  onConfigured: () => void;
  configured: boolean;
}

export function StepModel({ onConfigured, configured }: StepModelProps): JSX.Element {
  const { toast, updateSettings, dispatch } = useStore();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);

  const setupDemo = async (): Promise<void> => {
    setBusy(true);
    try {
      dispatch({ type: "model", model: await invoke("model:configure", { providerType: "mock" }) });
      await updateSettings({ demoMode: true });
      const status = await invoke("demo:load", { days: 3 });
      toast("success", `Demo mode ready with ${status.daysSimulated} simulated days`);
      onConfigured();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h2>Model setup</h2>
      <p>No cloud model is used by default. Pick how the local reasoning should work; you can change this later in Settings.</p>
      {configured ? <div className="callout callout-success">Model configured. You can continue or pick a different option.</div> : null}
      <div className="choice-list" role="radiogroup" aria-label="Model option">
        {CHOICES.map((c) => (
          <label key={c.id} className="choice" data-selected={choice === c.id}>
            <input type="radio" name="model-choice" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} />
            <span>
              <strong>{c.title}</strong>
              <span className="small muted" style={{ display: "block" }}>{c.text}</span>
            </span>
          </label>
        ))}
      </div>
      {choice === "demo" ? (
        <div className="callout">
          <p>Loads three days of synthetic activity so candidates, teaching and guided runs can be tried safely.</p>
          <Button variant="primary" busy={busy} onClick={() => void setupDemo()}>
            Use demo mode
          </Button>
        </div>
      ) : null}
      {choice === "endpoint" ? (
        <div className="callout">
          <EndpointForm onConfigured={() => { toast("success", "Endpoint configured"); onConfigured(); }} />
        </div>
      ) : null}
      {choice === "uimate" ? <UiMateInstall onConfigured={onConfigured} /> : null}
      {choice === "mlx" ? (
        <div className="callout stack">
          <div>
            <strong>Advanced MLX route</strong>
            <ol style={{ marginTop: 6 }}>
              <li>Read docs/MODEL_SETUP.md in the repository for the supported MLX versions and quantisations.</li>
              <li>Run the setup script: <code>node scripts/setup-mlx-route.mjs</code>. It converts the pinned weights and prints the server command.</li>
              <li>Start the MLX server it prints, then connect it below as an OpenAI-compatible endpoint.</li>
            </ol>
          </div>
          <EndpointForm initial={{ baseUrl: "http://127.0.0.1:8080/v1" }} onConfigured={() => { toast("success", "MLX endpoint configured"); onConfigured(); }} />
        </div>
      ) : null}
    </div>
  );
}

function UiMateInstall({ onConfigured }: { onConfigured: () => void }): JSX.Element {
  const { state, toast, dispatch } = useStore();
  const loader = useCallback(() => invoke("model:runtimeInfo"), []);
  const { data, error, loading, reload } = useLoader(loader);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const model = state.model;
  const rt = model?.runtime;
  const download = rt?.download;
  const progress = download?.active && download.totalBytes ? download.receivedBytes / download.totalBytes : null;

  const run = async (action: "installRuntime" | "installModel" | "start", label: string): Promise<void> => {
    setBusy(action);
    try {
      dispatch({ type: "model", model: await invoke("model:runtime", { action, confirmed: true }) });
      toast("success", label);
      if (action === "start") {
        dispatch({ type: "model", model: await invoke("model:configure", { providerType: "uimate", managedRuntime: true }) });
        onConfigured();
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="callout callout-danger">{error} <Button size="sm" onClick={reload}>Retry</Button></div>;
  if (loading || !data) return <Skeleton lines={4} />;

  return (
    <div className="callout stack">
      <dl className="kv">
        <dt>Runtime</dt>
        <dd>{data.runtimeRelease} <span className="mono small muted">sha256 {data.runtimeSha256.slice(0, 16)}</span></dd>
        <dt>Model</dt>
        <dd>{data.modelRepo} ({data.modelQuant}), {data.modelFile} <span className="mono small muted">sha256 {data.modelSha256.slice(0, 16)}</span></dd>
        <dt>Projector</dt>
        <dd>{data.mmprojFile} <span className="mono small muted">sha256 {data.mmprojSha256.slice(0, 16)}</span></dd>
        <dt>Download size</dt>
        <dd>{formatBytes(data.expectedBytes)}</dd>
        <dt>License</dt>
        <dd>{data.license}</dd>
        <dt>Sources</dt>
        <dd className="small">
          <span className="mono">{data.sourceUrl}</span>
          <br />
          <span className="mono">{data.runtimeUrl}</span>
        </dd>
      </dl>
      <Checkbox label={`I understand this downloads about ${formatBytes(data.expectedBytes)} from the sources above, verifies checksums, and runs a local server on 127.0.0.1.`} checked={confirmed} onCheckedChange={setConfirmed} />
      {download?.active ? (
        <div className="stack-sm">
          <span className="small">Downloading {download.file ?? ""}: {formatBytes(download.receivedBytes)}{download.totalBytes ? ` of ${formatBytes(download.totalBytes)}` : ""}</span>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress !== null ? Math.round(progress * 100) : undefined} aria-label="Download progress">
            <span style={{ width: progress !== null ? `${Math.round(progress * 100)}%` : "30%" }} />
          </div>
        </div>
      ) : null}
      <div className="row">
        <Button variant="primary" disabled={!confirmed || rt?.runtimeInstalled} busy={busy === "installRuntime"} onClick={() => void run("installRuntime", "Runtime installed")}>
          1. Install runtime{rt?.runtimeInstalled ? " (done)" : ""}
        </Button>
        <Button variant="primary" disabled={!confirmed || !rt?.runtimeInstalled || rt?.modelInstalled} busy={busy === "installModel"} onClick={() => void run("installModel", "Model downloaded and verified")}>
          2. Download model{rt?.modelInstalled ? " (done)" : ""}
        </Button>
        <Button variant="primary" disabled={!confirmed || !rt?.modelInstalled} busy={busy === "start"} onClick={() => void run("start", "Local model server started")}>
          3. Start and use
        </Button>
      </div>
      {rt?.lastError ? <div className="callout callout-danger">{rt.lastError}</div> : null}
    </div>
  );
}
