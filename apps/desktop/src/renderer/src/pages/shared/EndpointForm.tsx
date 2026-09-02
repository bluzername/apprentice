import { useState, type JSX } from "react";
import type { ModelHealth } from "@apprentice/schemas";
import { Button } from "../../components/Button";
import { TextInput } from "../../components/Field";
import { Badge } from "../../components/Badge";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";

export interface EndpointValues {
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface EndpointFormProps {
  initial?: Partial<EndpointValues>;
  onConfigured: () => void;
  submitLabel?: string;
}

function validate(values: EndpointValues): string | null {
  try {
    const url = new URL(values.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Base URL must start with http:// or https://.";
  } catch {
    return "Enter a valid base URL such as http://127.0.0.1:8080/v1.";
  }
  if (values.model.trim().length === 0) return "Enter the model name the endpoint expects.";
  return null;
}

/** OpenAI-compatible endpoint form with test connection then configure. */
export function EndpointForm({ initial, onConfigured, submitLabel = "Use this endpoint" }: EndpointFormProps): JSX.Element {
  const [values, setValues] = useState<EndpointValues>({ baseUrl: initial?.baseUrl ?? "http://127.0.0.1:8080/v1", model: initial?.model ?? "", apiKey: initial?.apiKey ?? "" });
  const [health, setHealth] = useState<ModelHealth | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validation = validate(values);

  const payload = (): { baseUrl: string; model: string; providerType: "openai_compatible"; apiKey?: string } => ({
    baseUrl: values.baseUrl.trim(),
    model: values.model.trim(),
    providerType: "openai_compatible",
    ...(values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {})
  });

  const test = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    try {
      setHealth(await invoke("model:testConnection", payload()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const { providerType: _providerType, ...endpoint } = payload();
      await invoke("model:configure", { providerType: "openai_compatible", endpoint });
      onConfigured();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void test(); }}>
      <TextInput label="Base URL" value={values.baseUrl} onValueChange={(baseUrl) => setValues({ ...values, baseUrl })} placeholder="http://127.0.0.1:8080/v1" hint="An OpenAI-compatible chat completions endpoint, for example llama.cpp, LM Studio, vLLM or an MLX server." />
      <TextInput label="Model" value={values.model} onValueChange={(model) => setValues({ ...values, model })} placeholder="ui-mate-9b" />
      <TextInput label="API key (optional)" type="password" autoComplete="off" value={values.apiKey} onValueChange={(apiKey) => setValues({ ...values, apiKey })} hint="Stored in the macOS keychain via safeStorage. Leave empty for local servers." />
      {validation ? <span className="field-error">{validation}</span> : null}
      {error ? (
        <div className="callout callout-danger" role="alert">
          {error}
        </div>
      ) : null}
      {health ? (
        <div className={`callout ${health.ok ? "callout-success" : "callout-danger"}`} role="status">
          <div className="row">
            <Badge tone={health.ok ? "success" : "danger"}>{health.ok ? "Connected" : "Failed"}</Badge>
            {health.latencyMs !== undefined ? <span className="small">{Math.round(health.latencyMs)} ms</span> : null}
            {health.model ? <span className="small">{health.model}</span> : null}
          </div>
          {health.message ? <p style={{ marginTop: 6 }}>{health.message}</p> : null}
          <div className="row small" style={{ marginTop: 6 }}>
            <span>Vision: {health.capabilities.vision ? "yes" : "no"}</span>
            <span>Structured output: {health.capabilities.structuredOutput ? "yes" : "no"}</span>
          </div>
        </div>
      ) : null}
      <div className="row">
        <Button type="submit" busy={testing} disabled={Boolean(validation)}>
          Test connection
        </Button>
        <Button variant="primary" busy={saving} disabled={Boolean(validation) || !health?.ok} onClick={() => void save()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
