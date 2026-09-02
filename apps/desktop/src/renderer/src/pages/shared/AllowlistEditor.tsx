import { useState, type JSX } from "react";
import { SUGGESTED_APPS, type AllowedApp } from "@apprentice/schemas";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ListEditor } from "../../components/ListEditor";
import { validateBundleId, validateDomain } from "../../lib/domain";

interface AllowlistValue {
  apps: AllowedApp[];
  domains: string[];
}

interface AllowlistEditorProps {
  value: AllowlistValue;
  onChange: (next: AllowlistValue) => void;
  showSuggestions?: boolean;
}

/** Apps and domains allowlist. Nothing is preselected; suggestions are opt-in. */
export function AllowlistEditor({ value, onChange, showSuggestions = true }: AllowlistEditorProps): JSX.Element {
  const [customId, setCustomId] = useState("");
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const selectedIds = new Set(value.apps.map((a) => a.bundleId));
  const suggestions = SUGGESTED_APPS.filter((a) => !selectedIds.has(a.bundleId));

  const addApp = (app: AllowedApp): void => {
    if (selectedIds.has(app.bundleId)) return;
    onChange({ ...value, apps: [...value.apps, app] });
  };
  const removeApp = (bundleId: string): void => onChange({ ...value, apps: value.apps.filter((a) => a.bundleId !== bundleId) });

  const addCustom = (): void => {
    const idResult = validateBundleId(customId);
    if (!idResult.ok || !idResult.value) {
      setCustomError(idResult.message ?? "Invalid bundle identifier.");
      return;
    }
    const name = customName.trim() || idResult.value.split(".").pop() || idResult.value;
    if (selectedIds.has(idResult.value)) {
      setCustomError("That app is already allowed.");
      return;
    }
    addApp({ bundleId: idResult.value, name: name.slice(0, 128) });
    setCustomId("");
    setCustomName("");
    setCustomError(null);
  };

  return (
    <div className="stack-lg">
      <div className="field">
        <span className="field-label">Allowed applications</span>
        {value.apps.length === 0 ? <span className="field-hint">No applications allowed yet. Nothing is captured until you add one.</span> : null}
        {value.apps.length > 0 ? (
          <ul className="chips" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {value.apps.map((app) => (
              <li key={app.bundleId} className="chip" title={app.bundleId}>
                <span>{app.name}</span>
                <button type="button" aria-label={`Remove ${app.name}`} onClick={() => removeApp(app.bundleId)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {showSuggestions && suggestions.length > 0 ? (
        <div className="field">
          <span className="field-label">Suggestions (not selected)</span>
          <ul className="chips" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {suggestions.map((app) => (
              <li key={app.bundleId}>
                <Button size="sm" onClick={() => addApp(app)} aria-label={`Add ${app.name}`} title={app.bundleId}>
                  <Icon name="plus" size={14} />
                  {app.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="field">
        <span className="field-label">Add another application</span>
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <input className="input input-sm" aria-label="Bundle identifier" placeholder="com.company.App" value={customId} onChange={(e) => { setCustomId(e.target.value); setCustomError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
          <input className="input input-sm" aria-label="Display name (optional)" placeholder="Display name" value={customName} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
          <Button size="sm" onClick={addCustom}>
            Add
          </Button>
        </div>
        <span className="field-hint">Find the bundle identifier with: osascript -e &apos;id of app &quot;Name&quot;&apos;</span>
        {customError ? (
          <div className="field-error" role="alert">
            {customError}
          </div>
        ) : null}
      </div>
      <ListEditor label="Allowed browser domains" items={value.domains} onChange={(domains) => onChange({ ...value, domains })} placeholder="notion.so" validate={validateDomain} addLabel="Add domain" />
    </div>
  );
}
